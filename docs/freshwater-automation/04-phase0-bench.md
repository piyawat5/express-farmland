# 🧪 เฟส 0 — หัดเล่น ESP32 บนโต๊ะ

> **เป้าหมาย:** ก่อนต่อน้ำจริง ต้องทำ 5 บทนี้ให้ผ่านทั้งหมด · ใช้เวลาประมาณ 1–2 วันหยุด
> **ยังไม่มีน้ำ ไม่มีไฟ 12V ไม่มีปั๊ม** — ไฟทั้งหมดมาจากสาย USB ต่อคอม (ปลอดภัย 100%)
> ต่อสายตาม [03-wiring.md ข้อ 2](./03-wiring.md#2-เฟส-0--ต่อบนโต๊ะ-ไฟเลี้ยงจาก-usb-อย่างเดียว) · ศัพท์ที่ไม่รู้ดู [01-glossary.md](./01-glossary.md)

---

## บทเตรียม: ติดตั้งโปรแกรม (ทำครั้งเดียว)

1. ดาวน์โหลด **Arduino IDE 2** จาก arduino.cc (เมนู Software) → ติดตั้งตามปกติ
2. เปิดโปรแกรม → แถบซ้ายกดไอคอน **Boards Manager** (รูปแผงวงจร) → ค้น `esp32` → กด Install ที่ **esp32 by Espressif Systems** (ไฟล์ใหญ่ รอหลายนาที)
   - ถ้าค้นไม่เจอ: เมนู File → Preferences → ช่อง "Additional boards manager URLs" ใส่ `https://espressif.github.io/arduino-esp32/package_esp32_index.json` → OK → ค้นใหม่
3. เสียบ ESP32 เข้าคอมด้วยสาย USB แบบ data
4. เมนู **Tools → Board → esp32 → ESP32 Dev Module**
5. เมนู **Tools → Port** → เลือก `COM` ที่เพิ่งโผล่มา (เช่น COM3)
   - ไม่มี COM ให้เลือก → (1) เปลี่ยนสาย USB (2) ลงไดรเวอร์ CH340 หรือ CP2102 ตามชิปบนบอร์ด แล้วถอด-เสียบใหม่

**ผ่านเมื่อ:** เลือก Board และ Port ได้

---

## บทที่ 1: ไฟกระพริบ

**ต่อสาย:** ไม่ต้องต่ออะไร (ใช้ไฟสีฟ้าบนบอร์ด)

File → New Sketch → ลบของเดิมทิ้ง วางโค้ดนี้ → กดปุ่มลูกศรขวา (Upload)

```cpp
const int LED_PIN = 2;  // ไฟสีฟ้าบนบอร์ด

void setup() {
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);  // เปิดไฟ
  delay(500);                   // รอ 0.5 วินาที
  digitalWrite(LED_PIN, LOW);   // ปิดไฟ
  delay(500);
}
```

**ผ่านเมื่อ:** ไฟสีฟ้ากระพริบทุกครึ่งวินาที · ลองเปลี่ยน 500 เป็น 100 แล้วอัปโหลดใหม่ ต้องกระพริบเร็วขึ้น

**ถ้าอัปโหลดค้างที่ `Connecting....____`:** กดปุ่ม **BOOT** บนบอร์ดค้างไว้จนเห็นตัวเลข % วิ่ง แล้วปล่อย

---

## บทที่ 2: ปุ่มกด + Serial Monitor

**ต่อสาย:** ปุ่ม 1 ตัว (ขั้ว NO) — ขาหนึ่งเข้า **GPIO27** อีกขาเข้า **GND**

```cpp
const int BUTTON_PIN = 27;
const int LED_PIN = 2;

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);  // ไม่กด = HIGH, กด = LOW
  pinMode(LED_PIN, OUTPUT);
  Serial.println("เริ่มทำงาน");
}

void loop() {
  bool pressed = digitalRead(BUTTON_PIN) == LOW;
  digitalWrite(LED_PIN, pressed ? HIGH : LOW);
  Serial.println(pressed ? "กดอยู่" : "ปล่อย");
  delay(300);
}
```

เปิด **Tools → Serial Monitor** → มุมขวาตั้งความเร็วเป็น **115200 baud**

**ผ่านเมื่อ:** กดปุ่ม = ไฟฟ้าติด + Serial Monitor ขึ้น "กดอยู่" · ปล่อย = "ปล่อย"
**ถ้าขึ้น "กดอยู่" ตลอด:** ต่อผิดคู่ขั้ว (ไปใช้ขั้ว NC) → ใช้มัลติมิเตอร์โหมดปี๊บหาคู่ที่ปี๊บเฉพาะตอนกด

---

## บทที่ 3: ลูกลอยในแก้วน้ำ + ตั้งแบบ fail-safe

**ขั้นที่ 1 — ตั้งทิศลูกลอยด้วยมัลติมิเตอร์ (ยังไม่ต่อ ESP32):**
1. มัลติมิเตอร์โหมดปี๊บ แตะปลายสายลูกลอยทั้ง 2 เส้น
2. จุ่มลูกลอยลงแก้วน้ำ (ลูกลอยลอยขึ้น) → ต้อง **ปี๊บ** · ยกขึ้นจากน้ำ (ลูกลอยตกลง) → ต้อง **เงียบ**
3. ถ้ากลับกัน → ถอดคลิปล่าง กลับหัวลูกลอย ใส่คลิปคืน ทดสอบใหม่
4. ตอนนี้ลูกลอยตัวนี้เป็น "แบบตัวล่าง" (น้ำท่วม = ต่อ) — ดูเหตุผลใน [03-wiring ข้อ 5](./03-wiring.md#5-ติดลูกลอยแบบ-fail-safe-สำคัญ)

**ขั้นที่ 2 — ต่อสาย:** สายลูกลอยเส้นหนึ่งเข้า **GPIO32** อีกเส้นเข้า **GND**

```cpp
const int FLOAT_PIN = 32;

void setup() {
  Serial.begin(115200);
  pinMode(FLOAT_PIN, INPUT_PULLUP);
}

void loop() {
  bool hasWater = digitalRead(FLOAT_PIN) == LOW;  // น้ำท่วมลูกลอย = วงจรต่อ = LOW
  Serial.println(hasWater ? "มีน้ำ" : "ไม่มีน้ำ");
  delay(500);
}
```

**ผ่านเมื่อ:**
- จุ่มน้ำ = "มีน้ำ" · ยกขึ้น = "ไม่มีน้ำ"
- **ทดสอบ fail-safe:** จุ่มลูกลอยไว้ในน้ำ แล้วคลายสกรูถอดสายลูกลอยออก 1 เส้น → ต้องขึ้น **"ไม่มีน้ำ"** (สายขาด = ระบบคิดว่าไม่มีน้ำ = ไม่ปั๊ม ✓)

---

## บทที่ 4: รีเลย์ทำงานตามลูกลอย

**ต่อสาย:** เพิ่มรีเลย์ตาม [03-wiring ข้อ 2](./03-wiring.md#2-เฟส-0--ต่อบนโต๊ะ-ไฟเลี้ยงจาก-usb-อย่างเดียว) — GPIO16 → `IN1`, VIN → `VCC`, GND → `GND` · **ตั้งจัมเปอร์เป็น H** · ขั้ว COM/NO ยังไม่ต่ออะไร

```cpp
const int FLOAT_PIN = 32;
const int RELAY_PIN = 16;

void setup() {
  Serial.begin(115200);
  pinMode(FLOAT_PIN, INPUT_PULLUP);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);  // เริ่มต้นปิดรีเลย์เสมอ
}

void loop() {
  bool hasWater = digitalRead(FLOAT_PIN) == LOW;
  digitalWrite(RELAY_PIN, hasWater ? HIGH : LOW);
  Serial.println(hasWater ? "มีน้ำ -> รีเลย์ติด" : "ไม่มีน้ำ -> รีเลย์ดับ");
  delay(500);
}
```

**ผ่านเมื่อ:** จุ่มลูกลอย = ได้ยิน "แกร๊ก" + ไฟช่อง 1 บนแผงรีเลย์ติด · ยกขึ้น = แกร๊ก + ไฟดับ
- **เช็คขั้วด้วยมัลติมิเตอร์:** โหมดปี๊บ แตะขั้ว `COM` กับ `NO` ของช่อง 1 → รีเลย์ติด = ปี๊บ, รีเลย์ดับ = เงียบ (นี่คือสวิตช์ที่จะใช้เปิดปั๊ม)
- **ถ้ารีเลย์ติดค้างไม่ยอมดับ:** จัมเปอร์ยังเป็น L → ย้ายไป H · ถ้าแผงไม่มีจัมเปอร์ = ซื้อผิดรุ่น (ดู 02 ข้อ "อย่าซื้อ")
- **กดปุ่ม EN (รีเซ็ต) บนบอร์ด:** ตอนบอร์ดรีสตาร์ต รีเลย์ต้อง **ไม่ติดแวบ** (ถ้าติดแวบ แจ้ง Claude — ต้องเปลี่ยนขา)

---

## บทที่ 5: WiFi + หน้าเว็บบนมือถือ

**ต่อสาย:** เหมือนบทที่ 4 · แก้ 2 บรรทัดแรกเป็นชื่อและรหัส WiFi บ้าน (ตัวพิมพ์เล็ก-ใหญ่ต้องตรง, ต้องเป็นคลื่น 2.4 GHz)

```cpp
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>

const char* WIFI_NAME = "ชื่อWiFiบ้าน";
const char* WIFI_PASS = "รหัสWiFiบ้าน";

const int RELAY_PIN = 16;
const int FLOAT_PIN = 32;

WebServer server(80);
bool relayOn = false;

void setRelay(bool on) {
  relayOn = on;
  digitalWrite(RELAY_PIN, on ? HIGH : LOW);
}

void handleRoot() {
  bool hasWater = digitalRead(FLOAT_PIN) == LOW;
  String html = "<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'>";
  html += "<meta http-equiv='refresh' content='3'>";  // รีเฟรชหน้าเองทุก 3 วิ
  html += "<h2>ทดสอบ ESP32</h2>";
  html += "<p>ลูกลอย: <b>" + String(hasWater ? "มีน้ำ" : "ไม่มีน้ำ") + "</b></p>";
  html += "<p>รีเลย์: <b>" + String(relayOn ? "เปิด" : "ปิด") + "</b></p>";
  html += "<p><a href='/on'><button style='font-size:24px'>เปิด</button></a> ";
  html += "<a href='/off'><button style='font-size:24px'>ปิด</button></a></p>";
  server.send(200, "text/html; charset=utf-8", html);
}

void goHome() {
  server.sendHeader("Location", "/");
  server.send(303);
}

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  setRelay(false);
  pinMode(FLOAT_PIN, INPUT_PULLUP);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_NAME, WIFI_PASS);
  Serial.print("กำลังต่อ WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("ต่อได้แล้ว เปิดมือถือไปที่ http://");
  Serial.println(WiFi.localIP());
  if (MDNS.begin("farm-water")) {
    Serial.println("หรือ http://farm-water.local");
  }

  server.on("/", handleRoot);
  server.on("/on", [] { setRelay(true); goHome(); });
  server.on("/off", [] { setRelay(false); goHome(); });
  server.begin();
}

void loop() {
  server.handleClient();
}
```

1. อัปโหลด → เปิด Serial Monitor → รอจนขึ้น `http://192.168.x.x`
2. มือถือ**ต่อ WiFi บ้านเดียวกัน** → เปิดเบราว์เซอร์ พิมพ์ที่อยู่นั้น

**ผ่านเมื่อ:** กด "เปิด"/"ปิด" บนมือถือแล้วรีเลย์แกร๊กตาม · จุ่ม/ยกลูกลอยแล้วหน้าเว็บเปลี่ยนภายใน 3 วิ
- หน้าเว็บนี้เปิดได้ **เฉพาะตอนอยู่ใน WiFi บ้าน** (เปิดจากนอกบ้านทำในเฟส 4)
- `farm-water.local` ไม่ขึ้น (Android บางรุ่น) → ใช้เลข IP แทน

---

## ✅ เช็คลิสต์จบเฟส 0

- [ ] อัปโหลดโค้ดได้เองโดยไม่ต้องถามใคร
- [ ] อ่านค่าปุ่มและลูกลอยใน Serial Monitor ได้
- [ ] ตั้งทิศลูกลอยด้วยมัลติมิเตอร์ได้ และทดสอบ "สายขาด = ไม่มีน้ำ" ผ่าน
- [ ] สั่งรีเลย์จากลูกลอยและจากมือถือได้ + รีเลย์ไม่ติดแวบตอนรีเซ็ต
- [ ] ใช้มัลติมิเตอร์เช็ค COM–NO ของรีเลย์ได้

ผ่านครบ → บอก Claude ว่า "จบเฟส 0 แล้ว" + ส่งรายชื่อ/รูปของเฟส 1 ที่ได้มาจริง → Claude เขียนเฟิร์มแวร์เฟส 1 ให้ตาม [05-phase1-build.md](./05-phase1-build.md)

## 🆘 แก้ปัญหาที่เจอบ่อย

| อาการ | สาเหตุที่พบบ่อย | แก้ |
|---|---|---|
| ไม่มี COM ให้เลือก | สาย USB ชาร์จอย่างเดียว / ไม่มีไดรเวอร์ | เปลี่ยนสาย / ลง CH340 หรือ CP2102 |
| อัปโหลดค้าง `Connecting...` | บอร์ดไม่เข้าโหมดรับโค้ด | กดปุ่ม BOOT ค้างตอนเริ่มอัป |
| Serial Monitor เป็นภาษาต่างดาว | ความเร็วไม่ตรง | ตั้ง 115200 baud |
| อ่านค่าปุ่ม/ลูกลอยกระโดดไปมา | สายหลวม / ลืมต่อ GND | ขันขั้วสกรูให้แน่น ดึงทดสอบ |
| รีเลย์ติดค้าง | จัมเปอร์เป็น L | ย้ายเป็น H |
| ต่อ WiFi ไม่ได้ (จุดวิ่งไม่หยุด) | ชื่อ/รหัสผิด หรือเป็นคลื่น 5 GHz | เช็คตัวพิมพ์ใหญ่-เล็ก / ใช้คลื่น 2.4 GHz |
