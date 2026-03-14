import { UserService } from './models';

export function UserCard() {
  const service = new UserService();
  return <div>{service.getUser().id}</div>;
}
