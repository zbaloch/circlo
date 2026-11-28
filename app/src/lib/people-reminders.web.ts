/**
 * The web app schedules no reminders (browsers can't without push); People's Coming up shows the same. Same exports
 * as people-reminders.ts.
 */
import type { Contact } from './people';

export async function peopleRemindersOn(): Promise<boolean> {
  return false;
}
export async function setPeopleRemindersOn(_on: boolean, _people: Contact[]): Promise<void> {}
export async function cancelPeopleReminders(): Promise<void> {}
export async function schedulePeopleReminders(_people: Contact[]): Promise<void> {}
