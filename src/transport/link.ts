/**
 * The byte-level link the master talks over.
 *
 * Kept deliberately narrow so the polling engine can be tested against a fake
 * link with no hardware and no browser — Web Serial is only one implementation.
 */

export interface SerialLink {
  readonly isOpen: boolean;

  write(data: Uint8Array): Promise<void>;

  /**
   * Resolves with the next chunk of received bytes, or `null` once the link
   * has closed. Chunk boundaries are arbitrary and carry no framing meaning.
   */
  read(): Promise<Uint8Array | null>;

  /** Discards anything already received but not yet read. */
  flush(): void;

  close(): Promise<void>;
}

/** Serial parameters, mirroring what Web Serial accepts. */
export interface SerialSettings {
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: 'none' | 'even' | 'odd';
}

export const DEFAULT_SERIAL_SETTINGS: SerialSettings = {
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
};

/** Baud rates worth offering in a picker; the field also accepts free entry. */
export const COMMON_BAUD_RATES = [
  1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600,
] as const;
