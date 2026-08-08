/**
 * A single Modbus transaction, described independently of how it is framed.
 *
 * Shared by the poll scheduler, the write dialogs and the scanners, so there
 * is exactly one shape of "thing to send" in the app.
 */

import {
  FC,
  buildReadRequest,
  buildWriteMultipleCoils,
  buildWriteMultipleRegisters,
  buildWriteSingleCoil,
  buildWriteSingleRegister,
} from '../protocol/pdu';

export type ReadRequest = {
  fc: typeof FC.READ_COILS | typeof FC.READ_DISCRETE_INPUTS
    | typeof FC.READ_HOLDING_REGISTERS | typeof FC.READ_INPUT_REGISTERS;
  slaveId: number;
  address: number;
  quantity: number;
};

export type ModbusRequest =
  | ReadRequest
  | { fc: typeof FC.WRITE_SINGLE_COIL; slaveId: number; address: number; value: boolean }
  | { fc: typeof FC.WRITE_SINGLE_REGISTER; slaveId: number; address: number; value: number }
  | { fc: typeof FC.WRITE_MULTIPLE_COILS; slaveId: number; address: number; values: boolean[] }
  | { fc: typeof FC.WRITE_MULTIPLE_REGISTERS; slaveId: number; address: number; values: number[] };

export type ModbusResult =
  | { kind: 'bits'; values: boolean[] }
  | { kind: 'registers'; values: number[] }
  | { kind: 'echo'; address: number; value: number };

export function isReadRequest(request: ModbusRequest): request is ReadRequest {
  return (
    request.fc === FC.READ_COILS ||
    request.fc === FC.READ_DISCRETE_INPUTS ||
    request.fc === FC.READ_HOLDING_REGISTERS ||
    request.fc === FC.READ_INPUT_REGISTERS
  );
}

export function buildRequestPdu(request: ModbusRequest): Uint8Array {
  switch (request.fc) {
    case FC.READ_COILS:
    case FC.READ_DISCRETE_INPUTS:
    case FC.READ_HOLDING_REGISTERS:
    case FC.READ_INPUT_REGISTERS:
      return buildReadRequest(request.fc, request.address, request.quantity);
    case FC.WRITE_SINGLE_COIL:
      return buildWriteSingleCoil(request.address, request.value);
    case FC.WRITE_SINGLE_REGISTER:
      return buildWriteSingleRegister(request.address, request.value);
    case FC.WRITE_MULTIPLE_COILS:
      return buildWriteMultipleCoils(request.address, request.values);
    case FC.WRITE_MULTIPLE_REGISTERS:
      return buildWriteMultipleRegisters(request.address, request.values);
  }
}

/** Slave 0 is a broadcast: every device acts on it, none of them answers. */
export function isBroadcast(request: ModbusRequest): boolean {
  return request.slaveId === 0;
}
