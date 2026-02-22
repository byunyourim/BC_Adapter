export interface Account {
  id?: number;
  address: string;
  chain: string;
  salt: string;
  createdAt?: Date;
}
