import { describe, expect, it } from "vitest";

import {
  decodeHealthSample,
  decodeProcessDetails,
} from "../src/health/decode.js";
import { mapGpu, mapHealth, mapStorage } from "../src/health/mappers.js";
import { emptyStaticInfo } from "../src/health/types.js";
import {
  writeBytesField,
  writeString,
  writeTag,
  writeU64,
  writeVarint,
} from "../src/ipc/pb.js";
import { mapProcessDetails } from "../src/process/mappers.js";

function writeBool(field: number, v: boolean, out: number[]): void {
  writeTag(field, 0, out);
  writeVarint(v ? 1 : 0, out);
}

function writeDouble(field: number, v: number, out: number[]): void {
  writeTag(field, 1, out);
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v, true);
  for (let i = 0; i < 8; i++) out.push(buf.getUint8(i));
}

function bytes(build: (out: number[]) => void): Uint8Array {
  const out: number[] = [];
  build(out);
  return Uint8Array.from(out);
}

describe("Pulse 1.5 protocol fields", () => {
  const disk = bytes((o) => {
    writeU64(1, 0, o);
    writeString(2, "Samsung SSD 980 PRO", o);
    writeString(3, "NVMe", o);
    writeBool(4, true, o);
    writeDouble(5, 41.5, o);
    writeBool(6, true, o);
    writeBool(7, false, o);
    writeBool(10, true, o);
    writeU64(11, 7, o);
    writeBool(12, true, o);
    writeU64(13, 100, o);
    writeU64(14, 10, o);
    writeBool(15, true, o);
    writeU64(16, 5123, o);
    writeBool(17, true, o);
    writeU64(18, 42, o);
  });

  const igpu = bytes((o) => {
    // int32 -1 is sent sign-extended as a 10-byte varint.
    writeTag(1, 0, o);
    writeVarint(0xffffffffffffffffn, o);
    writeU64(2, 1234, o);
    writeString(3, "Intel UHD Graphics", o);
    writeString(4, "Intel", o);
    writeBool(5, false, o);
    writeU64(7, 8_000_000_000, o);
    writeBool(8, true, o);
    writeDouble(9, 3.5, o);
  });

  const dgpu = bytes((o) => {
    writeU64(2, 5678, o);
    writeString(3, "NVIDIA GeForce RTX 4070", o);
    writeString(4, "NVIDIA", o);
    writeBool(5, true, o);
    writeU64(6, 12_000_000_000, o);
    writeBool(8, true, o);
    writeDouble(9, 64, o);
    writeBool(10, true, o);
    writeU64(11, 3_000_000_000, o);
  });

  const sample = decodeHealthSample(
    bytes((o) => {
      writeU64(1, Date.parse("2026-10-20T10:00:00.000Z"), o);
      writeBool(21, true, o);
      writeDouble(22, 55, o);
      writeBytesField(117, disk, o);
      writeBytesField(118, igpu, o);
      writeBytesField(118, dgpu, o);
    }),
  );

  it("decodes every disk's health", () => {
    expect(sample.diskHealth).toHaveLength(1);
    const d = sample.diskHealth[0]!;
    expect(d.model).toBe("Samsung SSD 980 PRO");
    expect(d.bus).toBe("NVMe");
    expect(d.tempC).toBe(41.5);
    expect(d.percentageUsed).toBe(7);
    expect(d.powerOnHours).toBe(5123);
    expect(d.unsafeShutdowns).toBe(42);
    expect(d.hasMediaErrors).toBe(false);
  });

  it("maps disk health with null for unreported values", () => {
    const storage = mapStorage(sample, emptyStaticInfo());
    expect(storage.diskHealth[0]).toMatchObject({
      model: "Samsung SSD 980 PRO",
      temperatureCelsius: 41.5,
      failurePredicted: false,
      wearPercentUsed: 7,
      availableSparePercent: 100,
      availableSpareThresholdPercent: 10,
      mediaErrors: null,
      bytesWritten: null,
    });
  });

  it("decodes every GPU, including a negative LUID high part", () => {
    expect(sample.gpus).toHaveLength(2);
    expect(sample.gpus[0]!.luidHigh).toBe(-1);
    expect(sample.gpus[0]!.name).toBe("Intel UHD Graphics");
    expect(sample.gpus[1]!.isPrimary).toBe(true);
  });

  it("maps every GPU and keeps primary-only fields on the primary", () => {
    const gpu = mapGpu(sample, emptyStaticInfo());
    expect(gpu.adapters).toHaveLength(2);
    expect(gpu.adapters[0]).toMatchObject({
      name: "Intel UHD Graphics",
      isPrimary: false,
      usagePercent: 3.5,
      sharedTotalBytes: 8_000_000_000,
    });
    expect(gpu.adapters[1]).toMatchObject({
      name: "NVIDIA GeForce RTX 4070",
      vendor: "NVIDIA",
      isPrimary: true,
      usagePercent: 64,
      dedicatedMemoryBytes: 3_000_000_000,
      temperatureCelsius: 55,
    });
    expect("note" in gpu).toBe(false);
  });

  it("lists every GPU in the static section", () => {
    const health = mapHealth({ info: emptyStaticInfo(), sample }, ["static"]);
    const stat = health.static as { gpu: Array<{ name: string }> };
    expect(stat.gpu.map((g) => g.name)).toEqual([
      "Intel UHD Graphics",
      "NVIDIA GeForce RTX 4070",
    ]);
  });

  it("falls back to the primary adapter on older services", () => {
    const old = decodeHealthSample(bytes((o) => writeU64(1, 1, o)));
    const info = emptyStaticInfo();
    info.gpuModel = "Legacy GPU";
    const gpu = mapGpu(old, info);
    expect(gpu.adapters).toHaveLength(1);
    expect(gpu.adapters[0]!.name).toBe("Legacy GPU");
    expect(gpu.note).toBeDefined();
  });

  it("decodes process CPU time", () => {
    const details = decodeProcessDetails(
      bytes((o) => {
        writeU64(1, 4242, o);
        writeString(2, "explorer.exe", o);
        writeU64(27, 98_765, o);
        writeBool(28, true, o);
      }),
    );
    expect(details.cpuTimeMs).toBe(98_765);
    expect(mapProcessDetails(details).cpuTimeMs).toBe(98_765);
    const none = decodeProcessDetails(bytes((o) => writeU64(1, 1, o)));
    expect(mapProcessDetails(none).cpuTimeMs).toBeNull();
  });
});
