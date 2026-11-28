import { deleteList, deleteNote, deleteTodo, orderTodos } from '@/lib/todos';

// The real response helper, with the API answering as the server does: 204 No Content, no body.
const mockCalls: string[] = [];
let mockStatus = 204;
jest.mock('@/api/client', () => {
  const { ok } = jest.requireActual('@/api/client');
  const answer = (path: string) => async () => {
    mockCalls.push(path);
    return { data: undefined, error: mockStatus === 204 ? undefined : { error: 'not_found' }, response: { ok: mockStatus < 300, status: mockStatus } };
  };
  return { ok, api: { PUT: (p: string) => answer(`PUT ${p}`)(), DELETE: (p: string) => answer(`DELETE ${p}`)() } };
});

beforeEach(() => {
  mockCalls.length = 0;
  mockStatus = 204;
});

describe('Todos calls that the server answers with no body', () => {
  it('count 204 No Content as done (moving and deleting used to say they failed)', async () => {
    await expect(orderTodos('g', ['a', 'b'])).resolves.toBeUndefined();
    await expect(deleteTodo('a')).resolves.toBeUndefined();
    await expect(deleteNote('a', 'n')).resolves.toBeUndefined();
    await expect(deleteList('w')).resolves.toBeUndefined();
    expect(mockCalls).toEqual([
      'PUT /v1/todos/lists/{listId}/order',
      'DELETE /v1/todos/{todoId}',
      'DELETE /v1/todos/{todoId}/notes/{noteId}',
      'DELETE /v1/todos/lists/{listId}',
    ]);
  });

  it('still fail when the server says no', async () => {
    mockStatus = 404;
    await expect(orderTodos('g', ['a'])).rejects.toMatchObject({ status: 404, code: 'not_found' });
    await expect(deleteTodo('a')).rejects.toMatchObject({ status: 404 });
  });
});
