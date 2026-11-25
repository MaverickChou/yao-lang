/* 由 yao 生成，请勿手工修改。 */
/* machine: 卦境   states: 64   events: 4 */
#include <stdint.h>

#define YAO_NONE 0xFFFFu
#define YAO_BEN(s)  ((uint16_t)((s) & 0x3Fu))
#define YAO_DONG(s) ((uint16_t)(((s) >> 6) & 0x3Fu))
#define YAO_ZHI(s)  ((uint16_t)(YAO_BEN(s) ^ YAO_DONG(s)))

/* 态 */
#define ST_0 0x003Fu  /* 乾 */
#define ST_1 0x0000u  /* 坤 */
#define ST_2 0x0011u  /* 屯 */
#define ST_3 0x0022u  /* 蒙 */
#define ST_4 0x0017u  /* 需 */
#define ST_5 0x003Au  /* 讼 */
#define ST_6 0x0002u  /* 师 */
#define ST_7 0x0010u  /* 比 */
#define ST_8 0x0037u  /* 小畜 */
#define ST_9 0x003Bu  /* 履 */
#define ST_10 0x0007u  /* 泰 */
#define ST_11 0x0038u  /* 否 */
#define ST_12 0x003Du  /* 同人 */
#define ST_13 0x002Fu  /* 大有 */
#define ST_14 0x0004u  /* 谦 */
#define ST_15 0x0008u  /* 豫 */
#define ST_16 0x0019u  /* 随 */
#define ST_17 0x0026u  /* 蛊 */
#define ST_18 0x0003u  /* 临 */
#define ST_19 0x0030u  /* 观 */
#define ST_20 0x0029u  /* 噬嗑 */
#define ST_21 0x0025u  /* 贲 */
#define ST_22 0x0020u  /* 剥 */
#define ST_23 0x0001u  /* 复 */
#define ST_24 0x0039u  /* 无妄 */
#define ST_25 0x0027u  /* 大畜 */
#define ST_26 0x0021u  /* 颐 */
#define ST_27 0x001Eu  /* 大过 */
#define ST_28 0x0012u  /* 坎 */
#define ST_29 0x002Du  /* 离 */
#define ST_30 0x001Cu  /* 咸 */
#define ST_31 0x000Eu  /* 恒 */
#define ST_32 0x003Cu  /* 遯 */
#define ST_33 0x000Fu  /* 大壮 */
#define ST_34 0x0028u  /* 晋 */
#define ST_35 0x0005u  /* 明夷 */
#define ST_36 0x0035u  /* 家人 */
#define ST_37 0x002Bu  /* 睽 */
#define ST_38 0x0014u  /* 蹇 */
#define ST_39 0x000Au  /* 解 */
#define ST_40 0x0023u  /* 损 */
#define ST_41 0x0031u  /* 益 */
#define ST_42 0x001Fu  /* 夬 */
#define ST_43 0x003Eu  /* 姤 */
#define ST_44 0x0018u  /* 萃 */
#define ST_45 0x0006u  /* 升 */
#define ST_46 0x001Au  /* 困 */
#define ST_47 0x0016u  /* 井 */
#define ST_48 0x001Du  /* 革 */
#define ST_49 0x002Eu  /* 鼎 */
#define ST_50 0x0009u  /* 震 */
#define ST_51 0x0024u  /* 艮 */
#define ST_52 0x0034u  /* 渐 */
#define ST_53 0x000Bu  /* 归妹 */
#define ST_54 0x000Du  /* 丰 */
#define ST_55 0x002Cu  /* 旅 */
#define ST_56 0x0036u  /* 巽 */
#define ST_57 0x001Bu  /* 兑 */
#define ST_58 0x0032u  /* 涣 */
#define ST_59 0x0013u  /* 节 */
#define ST_60 0x0033u  /* 中孚 */
#define ST_61 0x000Cu  /* 小过 */
#define ST_62 0x0015u  /* 既济 */
#define ST_63 0x002Au  /* 未济 */

/* 事件 */
#define EV_0 1u  /* 行(n) */
#define EV_1 2u  /* 错卦 */
#define EV_2 3u  /* 综卦 */
#define EV_3 4u  /* 互卦 */

#define YAO_START 0x002Au  /* 未济 */

/* 运行时 */
static uint16_t yao_cuo(uint16_t x) {
  return (uint16_t)((x & 0x3Fu) ^ 0x3Fu);
}
static uint16_t yao_zong(uint16_t x) {
  uint16_t v = (uint16_t)(x & 0x3Fu), r = 0;
  for (int i = 0; i < 6; i++) if ((v >> i) & 1u) r |= (uint16_t)(1u << (5 - i));
  return r;
}
static uint16_t yao_hu(uint16_t x) {
  uint16_t v = (uint16_t)(x & 0x3Fu);
  return (uint16_t)(((v >> 1) & 7u) | (((v >> 2) & 7u) << 3));
}

static uint16_t yao_transition(uint16_t s, uint16_t ev, uint8_t p0) {
  switch (ev) {
  case EV_0: {  /* 行(n) */
    return (uint16_t)((((YAO_BEN(s) ^ ((0x01u << ((p0 - 0x01u) & 0x3Fu)) & 0x3Fu)) & 0x3Fu)) | ((((0x01u << ((p0 - 0x01u) & 0x3Fu)) & 0x3Fu)) << 6));
  }

  case EV_1: {  /* 错卦 */
    (void)p0;
    return (uint16_t)((yao_cuo(YAO_BEN(s))) | ((0x3Fu) << 6));
  }

  case EV_2: {  /* 综卦 */
    (void)p0;
    return (uint16_t)((yao_zong(YAO_BEN(s))) | ((0x00u) << 6));
  }

  case EV_3: {  /* 互卦 */
    (void)p0;
    return (uint16_t)((yao_hu(YAO_BEN(s))) | ((0x00u) << 6));
  }
  }
  return YAO_NONE;
}

void yao_init(uint16_t *s) { *s = YAO_START; }

uint16_t yao_state(uint16_t s) { return s; }

/* 返回 0 = 已转移，1 = 该事件在此态下无定义 */
int yao_step(uint16_t *s, uint16_t ev, uint8_t p0) {
  uint16_t t = yao_transition(*s, ev, p0);
  if (t == YAO_NONE) return 1;
  *s = t;
  return 0;
}

/* ---- 可选：极简命令行宿主（纯 ASCII，不依赖字体） ---- */
#include <stdio.h>
#include <stdlib.h>

static void print_state(uint16_t s) {
  uint16_t b = YAO_BEN(s);
  char row[7];
  for (int p = 6; p >= 1; p--) row[6 - p] = (char)(((b >> (p - 1)) & 1u) ? '1' : '0');
  row[6] = 0;
  printf("state=%04X  ben=%s  dong=%d  zhi=%02X\n",
         (unsigned)s, row, (int)YAO_DONG(s), (unsigned)YAO_ZHI(s));
}

int main(void) {
  uint16_t s;
  char line[64];
  yao_init(&s);
  print_state(s);
  while (fgets(line, sizeof line, stdin)) {
    int ev = 0, arg = 0;
    if (line[0] == 'q') break;
    if (sscanf(line, "%d %d", &ev, &arg) < 1) continue;
    if (yao_step(&s, (uint16_t)ev, (uint8_t)arg) == 0) print_state(s);
    else printf("no transition\n");
  }
  return 0;
}

