interface IClient {
  telegramId: number;
  username: string;
  firstName: string;
  lastName: string | null;
  createdAt: Date;
}

export { IClient };
