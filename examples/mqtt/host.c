/*
 * MQTT 3.1.1 客户端 · C 宿主
 *
 * 状态机由爻编译（mqtt.yao → mqtt.c + mqtt.h）。
 * 宿主负责：socket、MQTT 报文编解码、定时器。
 * 机器只输出动作码：1 发 CONNECT、2 发 PINGREQ、3 发 DISCONNECT、4 关连接。
 *
 * 构建：
 *   yao build mqtt.yao --header -o mqtt.c
 *   gcc -std=c99 -Wall -Wextra -Werror mqtt.c host.c -o mqtt -lws2_32   # Windows
 *   gcc -std=c99 -Wall -Wextra -Werror mqtt.c host.c -o mqtt            # POSIX
 */

/* -std=c99 会让 glibc 隐藏 POSIX 声明，必须显式要求 */
#if !defined(_WIN32) && !defined(_POSIX_C_SOURCE)
#  define _POSIX_C_SOURCE 200809L
#endif

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#  include <winsock2.h>
#  include <ws2tcpip.h>
#  include <windows.h>
typedef SOCKET sock_t;
#  define BAD_SOCK INVALID_SOCKET
#  define sock_close closesocket
#  define sock_len int
#else
#  include <sys/socket.h>
#  include <sys/select.h>
#  include <time.h>
#  include <netinet/in.h>
#  include <arpa/inet.h>
#  include <netdb.h>
#  include <unistd.h>
typedef int sock_t;
#  define BAD_SOCK (-1)
#  define sock_close close
#  define sock_len socklen_t
#endif

#include "mqtt.h"

#define EV_CONNECT   EV_0  /* 连接 */
#define EV_CONNACK   EV_1  /* 收到CONNACK */
#define EV_PINGRESP  EV_2  /* 收到PINGRESP */
#define EV_DOWN      EV_3  /* 网络断 */
#define EV_TICK      EV_4  /* 心跳 */
#define EV_CLOSE     EV_5  /* 断开 */

#define PHASE(s) ((s) & 7u)
#define PING(s)  (((s) >> 3) & 1u)

static const char *PHASE_NAME[] = {
  "空闲", "连接中", "已连接", "关闭中", "重连等待",
};

/* ---- 动作收集：印 写到这里 ---- */

static uint8_t g_actions[16];
static int g_nactions;

static void collect(uint16_t v)
{
  if (g_nactions < (int)(sizeof g_actions)) g_actions[g_nactions++] = (uint8_t)v;
}

/* ---- 时间 ---- */

static long long now_ms(void)
{
#ifdef _WIN32
  return (long long)GetTickCount64();
#else
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (long long)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
#endif
}

/* ---- socket ---- */

static sock_t tcp_connect(const char *host, const char *port)
{
  struct addrinfo hints, *res = NULL;
  memset(&hints, 0, sizeof hints);
  hints.ai_family = AF_UNSPEC;
  hints.ai_socktype = SOCK_STREAM;

  if (getaddrinfo(host, port, &hints, &res) != 0) return BAD_SOCK;

  sock_t s = BAD_SOCK;
  for (struct addrinfo *p = res; p; p = p->ai_next) {
    s = socket(p->ai_family, p->ai_socktype, p->ai_protocol);
    if (s == BAD_SOCK) continue;
    if (connect(s, p->ai_addr, (sock_len)p->ai_addrlen) == 0) break;
    sock_close(s);
    s = BAD_SOCK;
  }
  freeaddrinfo(res);
  return s;
}

static int send_all(sock_t s, const uint8_t *buf, int len)
{
  int sent = 0;
  while (sent < len) {
    int n = send(s, (const char *)buf + sent, len - sent, 0);
    if (n <= 0) return -1;
    sent += n;
  }
  return 0;
}

/* ---- MQTT 报文 ---- */

static int mqtt_connect_pkt(sock_t s, const char *client_id)
{
  uint8_t buf[128];
  size_t idlen = strlen(client_id);
  if (idlen > 23) idlen = 23;

  int i = 0;
  buf[i++] = 0x10;                       /* CONNECT */
  buf[i++] = (uint8_t)(10 + 2 + idlen);  /* remaining length */
  buf[i++] = 0x00; buf[i++] = 0x04;      /* protocol name length */
  buf[i++] = 'M'; buf[i++] = 'Q'; buf[i++] = 'T'; buf[i++] = 'T';
  buf[i++] = 0x04;                       /* level 3.1.1 */
  buf[i++] = 0x02;                       /* clean session */
  buf[i++] = 0x00; buf[i++] = 0x3C;      /* keepalive 60s */
  buf[i++] = 0x00; buf[i++] = (uint8_t)idlen;
  memcpy(buf + i, client_id, idlen);
  i += (int)idlen;

  return send_all(s, buf, i);
}

static int mqtt_simple_pkt(sock_t s, uint8_t type)
{
  uint8_t b[2] = { type, 0x00 };
  return send_all(s, b, 2);
}

/* ---- 主循环 ---- */

int main(int argc, char **argv)
{
  const char *host = argc > 1 ? argv[1] : "127.0.0.1";
  const char *port = argc > 2 ? argv[2] : "1883";
  int seconds = argc > 3 ? atoi(argv[3]) : 8;

#ifdef _WIN32
  WSADATA wsa;
  if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
    fprintf(stderr, "WSAStartup 失败\n");
    return 1;
  }
#endif

  uint16_t s;
  yao_init(&s);
  yao_sink = collect;

  sock_t sock = BAD_SOCK;
  long long t0 = now_ms();
  long long last_tick = t0;
  long long last_attempt = 0;

  printf("  t  状态        动作\n");
  printf("  ------------------------------\n");

  /* 开局：要求连接 */
  yao_step(&s, EV_CONNECT, 0);

  while (now_ms() - t0 < (long long)seconds * 1000) {
    /* 1. 执行上一轮产生的动作 */
    for (int k = 0; k < g_nactions; k++) {
      const char *what = "";
      switch (g_actions[k]) {
        case 1:
          sock = tcp_connect(host, port);
          if (sock == BAD_SOCK) {
            /* 连不上也算断线，否则机器会卡在「连接中」*/
            what = "连接失败";
            yao_step(&s, EV_DOWN, 0);
            break;
          }
          mqtt_connect_pkt(sock, "yao-demo");
          what = "发 CONNECT";
          break;
        case 2: mqtt_simple_pkt(sock, 0xC0); what = "发 PINGREQ"; break;
        case 3: mqtt_simple_pkt(sock, 0xE0); what = "发 DISCONNECT"; break;
        case 4:
          if (sock != BAD_SOCK) { sock_close(sock); sock = BAD_SOCK; }
          what = "关连接";
          break;
        default: break;
      }
      printf("%4lld  %-8s  %s\n", (now_ms() - t0) / 1000, PHASE_NAME[PHASE(s)], what);
    }
    g_nactions = 0;

    /* 2. 收数据 */
    if (sock != BAD_SOCK) {
      fd_set rd;
      struct timeval tv = { 0, 150000 };
      FD_ZERO(&rd);
      FD_SET(sock, &rd);

      if (select((int)sock + 1, &rd, NULL, NULL, &tv) > 0) {
        uint8_t buf[256];
        int n = recv(sock, (char *)buf, sizeof buf, 0);
        if (n <= 0) {
          yao_step(&s, EV_DOWN, 0);
        } else {
          for (int i = 0; i < n; i++) {
            uint8_t type = (uint8_t)(buf[i] >> 4);
            if (type == 2) {          /* CONNACK */
              yao_step(&s, EV_CONNACK, 0);
              printf("%4lld  %-8s  收到 CONNACK\n", (now_ms() - t0) / 1000, PHASE_NAME[PHASE(s)]);
            } else if (type == 13) {  /* PINGRESP */
              yao_step(&s, EV_PINGRESP, 0);
              printf("%4lld  %-8s  收到 PINGRESP\n", (now_ms() - t0) / 1000, PHASE_NAME[PHASE(s)]);
            }
          }
        }
      }
    }

    /* 3. 心跳：仅已连接时每秒一次 */
    long long t = now_ms();
    if (t - last_tick >= 1000) {
      last_tick = t;
      if (PHASE(s) == 2 || PHASE(s) == 10) yao_step(&s, EV_TICK, 0);
    }

    /* 4. 重连退避：1 秒后自动重试 */
    if (PHASE(s) == 4 && t - last_attempt >= 1000) {
      last_attempt = t;
      yao_step(&s, EV_CONNECT, 0);
    }
  }

  if (sock != BAD_SOCK) sock_close(sock);

#ifdef _WIN32
  WSACleanup();
#endif
  return 0;
}
