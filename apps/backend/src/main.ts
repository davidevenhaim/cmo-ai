import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";

async function bootstrap() {
  const isDev = process.env.NODE_ENV === "development";
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const allowedChatIds = process.env.TELEGRAM_ALLOWED_CHAT_IDS;

  if (botToken && !isDev && (!allowedChatIds || allowedChatIds.trim() === "")) {
    console.error(
      "FATAL: TELEGRAM_BOT_TOKEN is set but TELEGRAM_ALLOWED_CHAT_IDS is empty. " +
        "Set at least one allowed chat ID before deploying with a bot token.",
    );
    process.exit(1);
  }

  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (botToken && !isDev && (!webhookSecret || webhookSecret.trim() === "")) {
    console.error(
      "FATAL: TELEGRAM_BOT_TOKEN is set but TELEGRAM_WEBHOOK_SECRET is empty. " +
        "Set a webhook secret to authenticate inbound updates.",
    );
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(3001);
  console.log("Backend running on http://localhost:3001");
}
bootstrap();
