import MailComposer from "nodemailer/lib/mail-composer";

export type MimeAttachment = {
  cid: string;
  filename: string;
  contentType: string;
  content: Buffer;
};

export type MimeMessageInput = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  listUnsubscribe?: string;
  attachments?: MimeAttachment[];
};

// MailComposer is used purely as an RFC822 MIME builder here — never as an
// SMTP transport. disableFileAccess/disableUrlAccess block any attachment or
// embedded-image option from reading local files or fetching remote URLs,
// since nothing in this app should ever let campaign content reach the
// filesystem or make server-side requests. Attachments are only ever passed
// as in-memory Buffers (never `path`/`href`), which never touches either of
// those code paths regardless of this setting.
export async function buildMime(input: MimeMessageInput): Promise<string> {
  const mail = new MailComposer({
    from: input.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    replyTo: input.replyTo,
    headers: input.listUnsubscribe
      ? [{ key: "List-Unsubscribe", value: `<${input.listUnsubscribe}>` }]
      : undefined,
    // filename: false (not omitted — nodemailer's MailComposer synthesizes
    // one from the content type whenever `filename` is falsy-but-not-exactly-
    // `false`) is the one thing that actually matters here. Every attachment
    // this app ever builds is a cid-referenced inline image (the logo, a
    // social icon), never a real file meant to be downloaded, and
    // nodemailer's own getAttachments() already infers
    // `Content-Disposition: inline` correctly for an image with a cid with
    // no help needed — that was never the problem. Gmail's inbox and message
    // header show a separate downloadable chip (e.g. "logo.png") for ANY MIME
    // part carrying a filename, regardless of what Content-Disposition says.
    // Suppressing the filename entirely is what actually stops the chip.
    attachments: input.attachments?.map((a) => ({
      cid: a.cid,
      filename: false as const,
      contentType: a.contentType,
      content: a.content,
    })),
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  const buffer: Buffer = await new Promise((resolve, reject) => {
    mail.compile().build((err, message) => {
      if (err) reject(err);
      else resolve(message);
    });
  });

  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
