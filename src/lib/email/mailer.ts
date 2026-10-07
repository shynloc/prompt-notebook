import nodemailer from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

class ConsoleMailer implements Mailer {
  async send(message: MailMessage) {
    console.info(`[mail:${message.subject}] to=${message.to}\n${message.text}`);
  }
}

class SmtpMailer implements Mailer {
  private readonly transporter: ReturnType<typeof nodemailer.createTransport>;

  constructor(
    host: string,
    port: number,
    user: string | undefined,
    password: string | undefined,
    private readonly from: string,
  ) {
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && password ? { user, pass: password } : undefined,
    });
  }

  async send(message: MailMessage) {
    await this.transporter.sendMail({ from: this.from, ...message });
  }
}

class MissingProductionMailer implements Mailer {
  async send() {
    throw new Error("SMTP_HOST and SMTP_FROM are required to send production email");
  }
}

export function createMailer(): Mailer {
  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM;

  if (host && from) {
    const port = Number(process.env.SMTP_PORT ?? "587");
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error("SMTP_PORT must be a valid TCP port");
    }

    return new SmtpMailer(
      host,
      port,
      process.env.SMTP_USER,
      process.env.SMTP_PASSWORD,
      from,
    );
  }

  return process.env.NODE_ENV === "production"
    ? new MissingProductionMailer()
    : new ConsoleMailer();
}
