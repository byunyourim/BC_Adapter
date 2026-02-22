export interface CreateAccountRequest {
  requestId: string;
  chain: string;
  salt: string;
}

export interface CreateAccountUseCase {
  createAccount(req: CreateAccountRequest): Promise<void>;
}
