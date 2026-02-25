export const Topics = {
  // Inbound (Subscribe)
  ACCOUNT_CREATE:     "adapter.account.create",
  DEPOSIT_CONFIRM:    "adapter.deposit.confirm",
  WITHDRAW_REQUEST:   "adapter.withdraw.request",
  WITHDRAW_STATUS:    "adapter.withdraw.status",

  // Outbound (Publish)
  ACCOUNT_CREATED:    "adapter.account.created",
  DEPOSIT_DETECTED:   "adapter.deposit.detected",
  DEPOSIT_CONFIRMED:  "adapter.deposit.confirmed",
  WITHDRAW_SENT:      "adapter.withdraw.sent",
  WITHDRAW_CONFIRMED: "adapter.withdraw.confirmed",
} as const;
