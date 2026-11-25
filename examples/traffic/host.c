/*
 * 交通灯 · C 宿主
 *
 * 状态机由爻编译（traffic.yao → traffic.c + traffic.h），这里只做两件事：
 *   1. 按秒驱动机器
 *   2. 把 6 位状态解码成灯的亮灭
 *
 * 机器不认识"灯"，它只知道一个 6 位数；把数变成灯，是宿主的活。
 * 这正是 SPEC §10 的分工：状态机纯函数，宿主负责一切 I/O。
 *
 * 构建：
 *   yao build traffic.yao --header -o traffic.c
 *   gcc -std=c99 -Wall -Wextra -Werror traffic.c host.c -o traffic
 */

#include <stdio.h>

#include "traffic.h"   /* 由 yao build --header 生成 */

/* 事件号来自生成的头文件，这里只起可读的名字 */
#define EV_SECOND EV_0   /* 秒 */
#define EV_WALK   EV_1   /* 行人 */

static const char *PHASE_NAME[] = {
  "NS_GREEN", "NS_YELLOW", "ALL_RED", "EW_GREEN", "EW_YELLOW",
};

static void render(uint16_t s, int tick, const char *note)
{
  unsigned phase = s & 7u;         /* 低 3 位：相位 */
  unsigned left  = (s >> 3) & 7u;  /* 高 3 位：剩余秒数 */

  const char *name = phase < 5 ? PHASE_NAME[phase] : "?";

  /* 相位 → 灯色，这是宿主的解释，不是机器的 */
  const char *ns = phase == 0 ? "G" : phase == 1 ? "Y" : "R";
  const char *ew = phase == 3 ? "G" : phase == 4 ? "Y" : "R";

  printf("%5d   %-10s %3u    %s   %s    %s\n", tick, name, left, ns, ew, note);
}

int main(void)
{
  uint16_t s;
  int t;

  yao_init(&s);

  printf("  tick   phase      left   NS  EW\n");
  printf("  ------------------------------------\n");
  render(s, 0, "");

  for (t = 1; t <= 24; t++) {
    const char *note = "";

    /* 第 2 秒来一个行人按钮（此时南北正绿） */
    if (t == 2) {
      if (yao_step(&s, EV_WALK, 0) != 0) {
        printf("行人事件在 tick %d 无定义\n", t);
        return 1;
      }
      note = "<- 行人按钮";
    }

    if (yao_step(&s, EV_SECOND, 0) != 0) {
      printf("秒事件在 tick %d 无定义\n", t);
      return 1;
    }
    render(s, t, note);
  }

  printf("\n  24 秒后状态 0x%02X，相位 %u，剩 %u 秒。\n",
         (unsigned)s, (unsigned)(s & 7u), (unsigned)((s >> 3) & 7u));
  return 0;
}
