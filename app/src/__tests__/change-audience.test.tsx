import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ChangeAudienceSheet } from '@/components/change-audience-sheet';
import { STARTER_CIRCLES } from '@/lib/addressbook';
import type { FeedPost } from '@/lib/posts';

const mockChange = jest.fn();
jest.mock('@/lib/posts', () => ({
  ...jest.requireActual('@/lib/posts'),
  changeAudience: (...args: unknown[]) => mockChange(...args),
}));
jest.mock('@/api/client', () => ({}));

const book = { circleDefs: STARTER_CIRCLES, contacts: {} };
const post: FeedPost = {
  postId: 'p1',
  authorId: 'me',
  authorName: 'Zaheer',
  authorHandle: 'zaheer',
  createdAtMs: 0,
  text: 'Columbus cafe',
  media: [],
  mine: true,
  audience: { kind: 'circles', ids: [1] },
  replyCount: 0,
  likeCount: 0,
  likedByMe: false,
};

describe('changing who can see my post', () => {
  beforeEach(() => mockChange.mockReset());

  it('starts from the current audience and saves the new one', async () => {
    const saved = jest.fn();
    mockChange.mockResolvedValue({ ...post, audience: { kind: 'circles', ids: [1, 2] } });
    await render(<ChangeAudienceSheet visible book={book} post={post} onClose={() => {}} onSaved={saved} />);

    expect(screen.getByRole('checkbox', { name: /Family/ }).props.accessibilityState.checked).toBe(true);
    // Nothing changed yet: nothing to save.
    expect(screen.getByRole('button', { name: 'Save' }).props.accessibilityState.disabled).toBe(true);

    await fireEvent.press(screen.getByRole('checkbox', { name: /Close Friends/ }));
    expect(screen.getByText(/Family, Close Friends/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saved).toHaveBeenCalledWith({ ...post, audience: { kind: 'circles', ids: [1, 2] } }));
    expect(mockChange).toHaveBeenCalledWith(post, { kind: 'circles', ids: [1, 2] });
  });

  it('needs an audience: unticking the last circle leaves nothing to save', async () => {
    await render(<ChangeAudienceSheet visible book={book} post={post} onClose={() => {}} onSaved={() => {}} />);
    await fireEvent.press(screen.getByRole('checkbox', { name: /Family/ }));
    expect(screen.getByRole('button', { name: 'Save' }).props.accessibilityState.disabled).toBe(true);
  });

  it('says so when it can’t save', async () => {
    mockChange.mockRejectedValue(new Error('offline'));
    await render(<ChangeAudienceSheet visible book={book} post={post} onClose={() => {}} onSaved={() => {}} />);
    await fireEvent.press(screen.getByRole('radio', { name: /Everyone/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText(/Couldn’t change it/)).toBeTruthy());
  });
});
