import { digestHourUtc } from '@/lib/time';

describe('the daily notification hour', () => {
  it('is 6pm on the phone’s clock, as an hour in UTC', () => {
    // Date.getTimezoneOffset(): minutes from local time to UTC (London in summer: -60).
    expect(digestHourUtc(0)).toBe(18); // London in winter
    expect(digestHourUtc(-60)).toBe(17); // London in summer
    expect(digestHourUtc(-300)).toBe(13); // Karachi
    expect(digestHourUtc(-330)).toBe(13); // India rounds to the nearer hour
    expect(digestHourUtc(300)).toBe(23); // New York in winter
    expect(digestHourUtc(480)).toBe(2); // Los Angeles in winter: the next day in UTC
    expect(digestHourUtc(-600)).toBe(8); // Sydney
  });
});
