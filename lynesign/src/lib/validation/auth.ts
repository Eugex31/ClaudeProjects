import { z } from "zod";

export const signUpSchema = z.object({
  name: z.string().min(1, "Enter your name."),
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(12, "Use at least 12 characters."),
  organizationName: z.string().min(1, "Name your organization."),
});

export const signInSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "That reset link is invalid or has expired."),
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(12, "Use at least 12 characters for your new password."),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
