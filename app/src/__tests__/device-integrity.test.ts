import * as Device from 'expo-device';

import { integrityWarning, isCompromised } from '@/lib/device-integrity';

jest.mock('expo-device', () => ({ isRootedExperimentalAsync: jest.fn() }));
jest.mock('expo-secure-store', () => ({}));

describe('rooted / jailbroken warning', () => {
  it('says nothing on a normal phone', () => {
    expect(integrityWarning(false, 'android')).toBeNull();
  });

  it('warns with the platform’s word, without blocking', () => {
    expect(integrityWarning(true, 'android')).toMatch(/rooted/);
    expect(integrityWarning(true, 'ios')).toMatch(/jailbroken/);
    expect(integrityWarning(true, 'ios')).toMatch(/still works/);
  });

  it('checks once per launch and treats a failed check as not compromised', async () => {
    (Device.isRootedExperimentalAsync as jest.Mock).mockRejectedValueOnce(new Error('unsupported'));
    await expect(isCompromised()).resolves.toBe(false);
    await expect(isCompromised()).resolves.toBe(false);
    expect(Device.isRootedExperimentalAsync).toHaveBeenCalledTimes(1);
  });
});
