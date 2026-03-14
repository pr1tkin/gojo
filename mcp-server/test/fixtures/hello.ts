export interface User {
  id: string;
}

export class UserService {
  getUser(): User {
    return { id: '1' };
  }
}

export function greet(): void {
  console.log('hello world');
}
