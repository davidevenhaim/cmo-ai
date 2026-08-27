export interface AlertPayload {
  recipient: string;
  subject: string;
  message: string;
  urgency: "low" | "medium" | "high";
}

export interface NotificationAdapter {
  sendAlert(payload: AlertPayload): Promise<void>;
}

export class NotImplementedNotificationAdapter implements NotificationAdapter {
  async sendAlert(_payload: AlertPayload): Promise<void> {
    throw new Error(
      "NotificationAdapter not implemented. Wire a concrete adapter.",
    );
  }
}
