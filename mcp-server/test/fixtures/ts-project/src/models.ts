export interface User {
  id: string;
}

export class UserService {
  getUser(): User {
    return { id: '1' };
  }
}

export const version = '1';
