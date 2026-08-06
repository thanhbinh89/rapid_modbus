# rapid_modbus — Đặc tả yêu cầu

Công cụ Modbus Master chạy trên trình duyệt bằng Web Serial API, phục vụ việc **triển khai và
chẩn đoán thiết bị Modbus ngoài hiện trường**.

Tham chiếu: [Modbus Poll](https://www.modbustools.com/mbpoll-user-manual.html).

---

## 1. Vì sao làm công cụ này

Modbus Poll là chuẩn de-facto trên Windows, nhưng có 3 điểm đau khi đi công trình:

| Vấn đề | Hệ quả ngoài hiện trường |
|---|---|
| Phải cài đặt | Laptop khách hàng thường khoá quyền admin → không cài được |
| Có license | Bản trial giới hạn 10 phút mỗi phiên |
| Chỉ chạy Windows | Không mượn được máy đồng nghiệp dùng macOS/Linux |

Web app chạy bằng Web Serial giải quyết cả ba: mở URL HTTPS là dùng ngay.

---

## 2. Phạm vi

### Làm

- Modbus **RTU** và **ASCII** qua Web Serial
- Function code **01, 02, 03, 04** (đọc) và **05, 06, 15, 16** (ghi)
- 29 display format
- Chẩn đoán: traffic monitor, slave scan, address scan, auto-detect
- Workspace JSON, export CSV, device profile
- PWA chạy offline

### Không làm

| Hạng mục | Lý do |
|---|---|
| **Modbus TCP / UDP** | Trình duyệt không mở được raw socket. Cần backend làm cầu WebSocket↔TCP → ngoài phạm vi. |
| **RTS toggle, DTR, DSR/CTS, remove echo** | JS không toggle RTS đủ nhanh cho RS-485 half-duplex. Dùng adapter USB-RS485 tự động điều hướng. |
| **FC 07, 08, 11, 17, 22, 23, 43/14** | Hiếm dùng khi triển khai thiết bị thực địa. |
| **Test Center** (gõ chuỗi hex thô) | Không cần cho mục tiêu triển khai. |
| **Data logging dài hạn** | Đây là công cụ chẩn đoán tại chỗ, không phải SCADA/historian. |
| **Realtime chart** | Như trên. |
| **OLE / Automation** | Không có tương đương trên web. |

---

## 3. Requirement

Ký hiệu: `P0` = MVP bắt buộc · `P1` = quan trọng, sau MVP · `P2` = nâng cao

### A. Kết nối

| ID | Requirement | Ưu tiên |
|---|---|---|
| A1 | Chọn cổng qua `requestPort()`; nhớ port đã cấp quyền bằng `getPorts()` để lần sau kết nối 1 chạm | P0 |
| A2 | Cấu hình: baud (1200–921600 + nhập tay), data bits 7/8, parity none/even/odd, stop bits 1/2 | P0 |
| A3 | Chọn mode **RTU** hoặc **ASCII** | P0 |
| A4 | Response timeout (mặc định 1000 ms), retry count, inter-frame delay | P0 |
| A5 | Tự phát hiện rút cáp USB (`disconnect` event) → dừng poll, báo rõ ràng | P0 |
| A6 | Thông báo tường minh khi trình duyệt không hỗ trợ Web Serial, kèm hướng dẫn dùng Chrome/Edge | P0 |

### B. Poll Definition & hiển thị

| ID | Requirement | Ưu tiên |
|---|---|---|
| B1 | Nhiều definition song song, scheduler quay vòng (round-robin) trên 1 connection | P0 |
| B2 | Tham số: Slave ID 0–255, FC, Address 0–65535, Quantity, Scan Rate 0–3.600.000 ms | P0 |
| B3 | FC đọc **01, 02, 03, 04** | P0 |
| B4 | FC ghi **05, 06, 15, 16** — double-click ô để mở dialog ghi | P0 |
| B5 | Toggle **PLC address base-1** (0xxxx / 1xxxx / 3xxxx / 4xxxx) ↔ protocol base-0 | P0 |
| B6 | 29 display format, đặt được theo từng ô hoặc cả cột | P0 |
| B7 | Enable/Disable từng definition; **Disable on Error** | P0 |
| B8 | Đặt tên cho từng thanh ghi (cột Name) | P0 |
| B9 | **Scaling** tuyến tính `y = a·x + b` + đơn vị hiển thị | P1 |
| B10 | **Conditional colors** — tô màu ô theo dải giá trị | P1 |
| B11 | **Value names** — map giá trị số → nhãn (0 = Off, 1 = Run, 2 = Fault) | P1 |
| B12 | **Enron/Daniel mode** (32-bit chiếm 1 địa chỉ thanh ghi) | P2 |

#### 29 display format

5 kiểu 16-bit: **Signed, Unsigned, Hex, ASCII, Binary**

6 kiểu rộng (**Int32, UInt32, Int64, UInt64, Float32, Float64**) × 4 word/byte order:

| Order | Byte layout | Tên gọi khác |
|---|---|---|
| `ABCD` | A B C D | big-endian |
| `BADC` | B A D C | big-endian byte swap |
| `CDAB` | C D A B | little-endian byte swap (word swap) |
| `DCBA` | D C B A | little-endian |

> Word order là **nguồn lỗi số 1** khi đọc float ngoài hiện trường. Phải có nút
> **đảo nhanh giữa 4 order** để thử — thay vì bắt người dùng mở menu chọn lại từng lần.

### C. Chẩn đoán — phần quan trọng nhất khi đi field

| ID | Requirement | Ưu tiên |
|---|---|---|
| C1 | **Communication Traffic** — hex dump Tx/Rx kèm timestamp, pause / clear / copy / export | P0 |
| C2 | Giải mã lỗi rõ ràng: exception code Modbus + lỗi transport (timeout, CRC sai, frame ngắn), kèm gợi ý kiểm tra gì | P0 |
| C3 | Bộ đếm Tx / Rx / Error + thời gian đáp ứng (min / avg / max) | P0 |
| C4 | **Slave ID Scan** — quét dải ID tìm thiết bị đang sống | P0 |
| C5 | **Address Scan** — quét dải địa chỉ tìm thanh ghi hợp lệ, export CSV | P1 |
| C6 | **Auto-Detect Wizard** — quét tổ hợp baud × parity × slave ID, báo cáo tổ hợp bắt được thiết bị | P1 |

> **C6 là điểm khác biệt lớn nhất so với Modbus Poll.**
> Vấn đề số 1 ngoài hiện trường là *"không biết baud/parity/slave ID của thiết bị này"* —
> datasheet thất lạc, kỹ thuật viên trước đã đổi cấu hình. Modbus Poll bắt thử tay từng tổ
> hợp. Tự động hoá tiết kiệm hàng giờ mỗi lần đi công trình.

### D. Dữ liệu & phiên làm việc (không backend)

| ID | Requirement | Ưu tiên |
|---|---|---|
| D1 | **Workspace JSON** — export/import toàn bộ cấu hình (connection + definitions + format + tên) | P0 |
| D2 | Auto-save workspace vào IndexedDB, khôi phục khi mở lại | P0 |
| D3 | Export dữ liệu đang hiển thị ra **CSV** (tải qua Blob, không cần server) | P0 |
| D4 | **Device Profile** — import bản đồ thanh ghi (CSV/JSON: tên, địa chỉ, kiểu, scale, đơn vị) cho từng model thiết bị; chia sẻ được qua file | P1 |
| D5 | **Diagnostic Report** — xuất 1 file gồm cấu hình + traffic log + giá trị đọc được, gửi về văn phòng hỗ trợ | P1 |

> **D4** phục vụ trực tiếp mục tiêu triển khai: cùng một model thiết bị được lắp lặp đi lặp
> lại. Import profile một lần → thấy `"Điện áp L1 = 231.4 V"` thay vì `"40001 = 2314"`.
> Modbus Poll hoàn toàn không có tính năng này.

### E. Phi chức năng

| ID | Requirement | Ưu tiên |
|---|---|---|
| E1 | **PWA + service worker** → chạy offline hoàn toàn sau lần mở đầu tiên | P0 |
| E2 | Deploy tĩnh lên GitHub Pages (HTTPS — bắt buộc cho Web Serial) | P0 |
| E3 | **Không backend** — mọi thứ chạy trong trình duyệt | P0 |
| E4 | Dark mode + chế độ tương phản cao (phòng máy tối / ngoài nắng) | P1 |
| E5 | Layout responsive dùng được trên tablet | P1 |
| E6 | Poll ổn định không rò rỉ bộ nhớ khi chạy nhiều giờ (giới hạn buffer traffic) | P0 |
| E7 | Unit test cho toàn bộ tầng protocol (CRC, framing, 29 format codec) | P0 |
| E8 | Giấy phép **MIT** | P0 |

> **E1 không phải nice-to-have.** Tủ điện, trạm biến áp, nhà máy thường không có internet.
> App phải mở được và chạy đầy đủ khi hoàn toàn offline.

---

## 4. Ràng buộc kỹ thuật

### 4.1 Không thể làm Modbus TCP nếu không có backend

Trình duyệt không mở được raw TCP/UDP socket. `fetch` và WebSocket là giao thức tầng ứng
dụng, không chở được Modbus TCP. Direct Sockets API chỉ khả dụng trong Isolated Web App,
không phải web thường.

→ rapid_modbus là công cụ **serial-only**. README nói rõ điều này.

### 4.2 Tách frame theo độ dài kỳ vọng, không theo timing t3.5

Web Serial trả byte theo chunk tuỳ ý — **ranh giới chunk ≠ ranh giới frame**. Timer JS quá
thô để phát hiện khoảng lặng 3.5 ký tự mà RTU framing dựa vào.

Vì ta luôn là master và biết mình vừa gửi gì, có thể suy ra độ dài frame từ 2–3 byte đầu:

| Trường hợp | Tổng độ dài frame RTU |
|---|---|
| Exception (FC có bit 0x80) | 5 byte |
| FC 01–04 | `3 + byteCount + 2` |
| FC 05, 06, 15, 16 | 8 byte cố định |

Timer t3.5 chỉ giữ lại làm **fallback xả rác** trên đường truyền.

Modbus ASCII thì đơn giản hơn — frame kết thúc bằng CRLF nên chỉ cần quét delimiter.

### 4.3 RS-485

Không điều khiển RTS/DTR. JS không toggle RTS đủ nhanh để lái transceiver RS-485 giữa các
byte. Hầu hết adapter USB-RS485 hiện đại tự động điều hướng bằng phần cứng.

→ README yêu cầu rõ: **dùng adapter có auto direction control**.

### 4.4 Tương thích trình duyệt

| Nền tảng | Trạng thái (08/2026) |
|---|---|
| Chrome / Edge / Opera desktop 89+ (Windows, macOS, Linux, ChromeOS) | ✅ Ổn định |
| Chrome Android 148+ | 🟡 Mới, giới hạn số máy (Android Serial API) |
| Safari, Firefox | ❌ Không hỗ trợ, không có kế hoạch |

→ Đối tượng chính: **laptop Windows + Chrome/Edge**. Android là bonus, không tính vào MVP.

---

## 5. Kiến trúc

Nguyên tắc: **tầng protocol thuần tuý, không phụ thuộc browser** → test được không cần phần
cứng. Đây là nơi bug gây đau nhất (CRC sai, byte order sai) nên phải phủ test kín.

```
src/
  protocol/              # ZERO browser deps — pure TypeScript, đã có test
    crc16.ts             # CRC-16/MODBUS
    lrc.ts               # LRC cho ASCII mode
    pdu.ts               # build request / parse response theo FC
    aduRtu.ts            # đóng/mở frame RTU
    aduAscii.ts          # đóng/mở frame ASCII
    expectedLength.ts    # suy ra độ dài frame kỳ vọng
    formats.ts           # 29 format: decode + encode
    errors.ts            # exception code + lỗi transport, kèm gợi ý
  transport/
    webSerial.ts         # wrapper SerialPort: open/close/write/read
    framer.ts            # gom byte → frame (length-driven + t3.5 fallback)
  core/
    master.ts            # hàng đợi request, timeout, retry
    scheduler.ts         # round-robin qua các definition
    scanner.ts           # slave scan / address scan / auto-detect
  store/                 # Zustand slices: connection, definitions, values, traffic
  ui/                    # React components
```

### Thư viện

| Mục đích | Chọn | Lý do |
|---|---|---|
| Build | Vite | Dev server chạy localhost → Web Serial hoạt động |
| UI | React + TypeScript | Grid nhiều cửa sổ + dialog |
| State | Zustand | ~1 KB, hợp dữ liệu polling liên tục |
| Style | Tailwind CSS | Dark mode sẵn |
| Lưu trữ | idb | Wrapper IndexedDB nhỏ gọn |
| PWA | vite-plugin-pwa | Workbox |
| Test | Vitest | Chạy tầng protocol không cần browser |

---

## 6. Tiến độ

- [x] Tầng `protocol/` + unit test
- [ ] `transport/` — Web Serial wrapper + frame reader
- [ ] `core/` — master, scheduler, scanner
- [ ] UI — grid, dialog ghi, traffic monitor
- [ ] Workspace + device profile
- [ ] PWA + GitHub Pages
