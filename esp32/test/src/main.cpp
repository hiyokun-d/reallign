#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// Objek untuk dua sensor MPU6050
Adafruit_MPU6050 mpu1; // Sensor 1 (Punggung) -> Alamat I2C: 0x68
Adafruit_MPU6050 mpu2; // Sensor 2 (Leher)    -> Alamat I2C: 0x69

// Pin untuk Modul Motor Getar
const int motorPin = 18;

// Variabel untuk menyimpan sudut kemiringan saat ini
float pitch1 = 0;
float pitch2 = 0;

// Variabel kalibrasi (Titik nol derajat saat pertama kali duduk tegak)
float baselinePitch1 = 0;
float baselinePitch2 = 0;

// Ambang batas kemiringan dan timer untuk getaran (bisa diubah lewat BLE)
float slouchThreshold = 20.0;             // Jika miring lebih dari 20 derajat dari posisi tegak
unsigned long slouchDurationLimit = 3000; // Harus bungkuk selama 3 detik baru bergetar
unsigned long slouchStartTime = 0;
bool isSlouching = false;
bool alertEnabled = true; // Getaran bisa dimatikan dari HP
bool motorOn = false;

// --- BLE: Nordic UART Service (NUS) ---
// Didukung oleh aplikasi: Adafruit Bluefruit Connect, Serial Bluetooth Terminal, nRF Connect
#define DEVICE_NAME "PostureMonitor"
#define NUS_SERVICE_UUID "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_RX_UUID "6E400002-B5A3-F393-E0A9-E50E24DCCA9E" // HP -> ESP32 (perintah)
#define NUS_TX_UUID "6E400003-B5A3-F393-E0A9-E50E24DCCA9E" // ESP32 -> HP (data)

BLEServer *bleServer = nullptr;
BLECharacteristic *txChar = nullptr;
bool bleConnected = false;
bool bleWasConnected = false;

// Perintah dari HP disimpan di sini lalu diproses di loop()
// (jangan proses di callback BLE karena kalibrasi memakai delay)
String pendingCmd = "";
volatile bool cmdReady = false;

void calibrateSensors();
void bleSend(const String &msg);
void handleCommand(String cmd);

class ServerCallbacks : public BLEServerCallbacks
{
  void onConnect(BLEServer *server) override
  {
    bleConnected = true;
  }
  void onDisconnect(BLEServer *server) override
  {
    bleConnected = false;
  }
};

class RxCallbacks : public BLECharacteristicCallbacks
{
  void onWrite(BLECharacteristic *chr) override
  {
    if (cmdReady)
      return; // Perintah sebelumnya belum diproses
    pendingCmd = String(chr->getValue().c_str());
    cmdReady = true;
  }
};

void setupBLE()
{
  BLEDevice::init(DEVICE_NAME);
  bleServer = BLEDevice::createServer();
  bleServer->setCallbacks(new ServerCallbacks());

  BLEService *service = bleServer->createService(NUS_SERVICE_UUID);

  txChar = service->createCharacteristic(NUS_TX_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  txChar->addDescriptor(new BLE2902());

  BLECharacteristic *rxChar = service->createCharacteristic(
      NUS_RX_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rxChar->setCallbacks(new RxCallbacks());

  service->start();

  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(NUS_SERVICE_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();

  Serial.println("BLE aktif, nama: " DEVICE_NAME);
}

// Kirim teks ke HP (dipotong per 20 byte agar aman untuk MTU default)
void bleSend(const String &msg)
{
  if (!bleConnected)
    return;
  const size_t chunk = 20;
  for (size_t i = 0; i < msg.length(); i += chunk)
  {
    String part = msg.substring(i, i + chunk);
    txChar->setValue((uint8_t *)part.c_str(), part.length());
    txChar->notify();
    delay(5);
  }
}

// Log ke Serial Monitor dan HP sekaligus
void logMsg(const String &msg)
{
  Serial.println(msg);
  bleSend(msg + "\n");
}

void setup()
{
  Serial.begin(115200);
  pinMode(motorPin, OUTPUT);
  digitalWrite(motorPin, LOW);

  Wire.begin();
  Wire.setClock(100000); // Menjaga kestabilan I2C

  setupBLE();

  Serial.println("Memulai Inisialisasi Sensor...");

  // 1. Inisialisasi Sensor Punggung (0x68)
  if (!mpu1.begin(0x68))
  {
    Serial.println("GAGAL: Sensor Punggung (0x68) tidak ditemukan!");
    while (1)
    {
      delay(10);
    }
  }
  Serial.println("OK: Sensor Punggung Ditemukan!");

  // 2. Inisialisasi Sensor Leher (0x69)
  if (!mpu2.begin(0x69))
  {
    Serial.println("GAGAL: Sensor Leher (0x69) tidak ditemukan!");
    while (1)
    {
      delay(10);
    }
  }
  Serial.println("OK: Sensor Leher Ditemukan!");

  mpu1.setAccelerometerRange(MPU6050_RANGE_2_G);
  mpu2.setAccelerometerRange(MPU6050_RANGE_2_G);

  Serial.println("Menyiapkan Kalibrasi...");
  Serial.println("Silakan duduk dengan TEGAK SEMPURNA dalam 5 detik...");
  delay(5000);

  calibrateSensors();
}

void setMotor(bool on)
{
  motorOn = on;
  digitalWrite(motorPin, on ? HIGH : LOW);
}

// Daftar perintah dari HP (kirim sebagai teks):
//   CAL      -> kalibrasi ulang (duduk tegak dulu, 5 detik)
//   T=25     -> ubah ambang batas sudut (derajat)
//   D=5000   -> ubah durasi bungkuk sebelum getar (ms)
//   ON / OFF -> aktifkan / matikan getaran
//   BUZZ     -> tes motor getar 0.5 detik
//   STATUS   -> tampilkan pengaturan saat ini
void handleCommand(String cmd)
{
  cmd.trim();
  cmd.toUpperCase();
  if (cmd.length() == 0)
    return;

  if (cmd == "CAL")
  {
    logMsg("Kalibrasi dalam 5 detik, duduk tegak...");
    setMotor(false);
    delay(5000);
    calibrateSensors();
  }
  else if (cmd.startsWith("T="))
  {
    float v = cmd.substring(2).toFloat();
    if (v > 0 && v < 90)
    {
      slouchThreshold = v;
      logMsg("Ambang: " + String(slouchThreshold, 1) + " deg");
    }
    else
    {
      logMsg("ERR: T harus 1-89");
    }
  }
  else if (cmd.startsWith("D="))
  {
    long v = cmd.substring(2).toInt();
    if (v >= 0 && v <= 60000)
    {
      slouchDurationLimit = v;
      logMsg("Durasi: " + String(slouchDurationLimit) + " ms");
    }
    else
    {
      logMsg("ERR: D harus 0-60000");
    }
  }
  else if (cmd == "ON")
  {
    alertEnabled = true;
    logMsg("Getaran: ON");
  }
  else if (cmd == "OFF")
  {
    alertEnabled = false;
    setMotor(false);
    logMsg("Getaran: OFF");
  }
  else if (cmd == "BUZZ")
  {
    setMotor(true);
    delay(500);
    setMotor(false);
    logMsg("Tes motor selesai");
  }
  else if (cmd == "STATUS")
  {
    logMsg("T=" + String(slouchThreshold, 1) + " D=" + String(slouchDurationLimit) +
           " Getar=" + (alertEnabled ? "ON" : "OFF"));
  }
  else
  {
    logMsg("Perintah: CAL, T=, D=, ON, OFF, BUZZ, STATUS");
  }
}

void loop()
{
  // Iklan ulang setelah HP terputus agar bisa tersambung lagi
  if (!bleConnected && bleWasConnected)
  {
    delay(300);
    BLEDevice::startAdvertising();
    Serial.println("BLE terputus, iklan ulang...");
  }
  if (bleConnected && !bleWasConnected)
  {
    Serial.println("BLE tersambung!");
  }
  bleWasConnected = bleConnected;

  logMsg("Test 1234");

  if (cmdReady)
  {
    String cmd = pendingCmd;
    cmdReady = false;
    handleCommand(cmd);
  }

  sensors_event_t a1, g1, temp1;
  sensors_event_t a2, g2, temp2;

  mpu1.getEvent(&a1, &g1, &temp1);
  mpu2.getEvent(&a2, &g2, &temp2);

  // --- RUMUS UNTUK POSISI VERTIKAL ---
  // Menghitung sudut pitch berdasarkan sumbu Z dan Y (atau X dan Y tergantung orientasi fisik pemasangan chip)
  float rawPitch1 = atan2(a1.acceleration.z, a1.acceleration.y) * 180 / PI;
  float rawPitch2 = atan2(a2.acceleration.z, a2.acceleration.y) * 180 / PI;

  // Mendapatkan selisih sudut saat ini dikurangi titik acuan (baseline saat kalibrasi)
  pitch1 = rawPitch1 - baselinePitch1;
  pitch2 = rawPitch2 - baselinePitch2;

  // Cetak ke Serial Monitor untuk memantau nilai
  Serial.print("Punggung: ");
  Serial.print(pitch1);
  Serial.print(" | Leher: ");
  Serial.println(pitch2);

  // --- LOGIKA PENGECEKAN BUNGKUK ---
  if (abs(pitch1) > slouchThreshold || abs(pitch2) > slouchThreshold)
  {
    if (!isSlouching)
    {
      slouchStartTime = millis();
      isSlouching = true;
    }
    else
    {
      if (alertEnabled && !motorOn && millis() - slouchStartTime > slouchDurationLimit)
      {
        logMsg("PERINGATAN: Postur memburuk!");
        setMotor(true);
      }
    }
  }
  else
  {
    isSlouching = false;
    setMotor(false);
  }

  // Kirim data ke HP format CSV: punggung,leher,motor
  // (format ini langsung bisa digambar di menu Plotter aplikasi Bluefruit Connect)
  bleSend(String(pitch1, 1) + "," + String(pitch2, 1) + "," + String(motorOn ? 1 : 0) + "\n");

  delay(200);
}

// Fungsi untuk merekam posisi duduk ideal secara otomatis
void calibrateSensors()
{
  sensors_event_t a1, g1, temp1;
  sensors_event_t a2, g2, temp2;

  float sumPitch1 = 0;
  float sumPitch2 = 0;
  int sampleCount = 50;

  Serial.println("Sedang mengambil data kalibrasi (Jangan bergerak)...");

  for (int i = 0; i < sampleCount; i++)
  {
    mpu1.getEvent(&a1, &g1, &temp1);
    mpu2.getEvent(&a2, &g2, &temp2);

    sumPitch1 += atan2(a1.acceleration.z, a1.acceleration.y) * 180 / PI;
    sumPitch2 += atan2(a2.acceleration.z, a2.acceleration.y) * 180 / PI;
    delay(50);
  }

  baselinePitch1 = sumPitch1 / sampleCount;
  baselinePitch2 = sumPitch2 / sampleCount;

  logMsg("Kalibrasi Selesai!");
  logMsg("Nol Punggung: " + String(baselinePitch1, 1));
  logMsg("Nol Leher: " + String(baselinePitch2, 1));
}
