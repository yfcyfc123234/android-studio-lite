import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type AdbDeviceKind = 'physical' | 'emulator';

export interface AdbDevice {
    /** ADB serial, e.g. 98311FFAZ005R4 or emulator-5554 */
    serial: string;
    state: string;
    kind: AdbDeviceKind;
    /** product / model hints from `adb devices -l` when present */
    model?: string;
    product?: string;
    device?: string;
}

/**
 * Parse `adb devices -l` into online devices (state === device).
 */
export function parseAdbDevicesList(output: string): AdbDevice[] {
    const devices: AdbDevice[] = [];
    for (const raw of output.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('List of devices')) {
            continue;
        }
        const parts = line.split(/\s+/);
        if (parts.length < 2) {
            continue;
        }
        const serial = parts[0];
        const state = parts[1];
        if (state !== 'device') {
            continue;
        }
        const props: Record<string, string> = {};
        for (let i = 2; i < parts.length; i++) {
            const eq = parts[i].indexOf(':');
            if (eq > 0) {
                props[parts[i].slice(0, eq)] = parts[i].slice(eq + 1);
            }
        }
        devices.push({
            serial,
            state,
            kind: serial.startsWith('emulator-') ? 'emulator' : 'physical',
            model: props.model,
            product: props.product,
            device: props.device,
        });
    }
    return devices;
}

export async function listOnlineAdbDevices(adbPath: string): Promise<AdbDevice[]> {
    const { stdout } = await execFileAsync(adbPath, ['devices', '-l'], {
        timeout: 15000,
        windowsHide: true,
    });
    return parseAdbDevicesList(stdout);
}

export function formatAdbDeviceLabel(d: AdbDevice): string {
    const name = d.model || d.product || d.device || d.serial;
    if (d.kind === 'emulator') {
        return `Emulator (${d.serial})`;
    }
    return `${name} [${d.serial}]`;
}
