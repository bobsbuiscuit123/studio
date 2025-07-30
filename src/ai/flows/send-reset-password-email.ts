'use server';

/**
 * @fileOverview A flow to handle sending a password reset email.
 *
 * - sendResetPasswordEmail - A function that simulates sending a reset email.
 * - SendResetPasswordEmailInput - The input type for the sendResetPasswordEmail function.
 * - SendResetPasswordEmailOutput - The return type for the sendResetPasswordEmail function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const SendResetPasswordEmailInputSchema = z.object({
  email: z.string().email().describe('The email address to send the reset link to.'),
});
export type SendResetPasswordEmailInput = z.infer<
  typeof SendResetPasswordEmailInputSchema
>;

const SendResetPasswordEmailOutputSchema = z.object({
    success: z.boolean().describe('Whether the email was sent successfully.'),
    message: z.string().describe('A message to show to the user.'),
});
export type SendResetPasswordEmailOutput = z.infer<
  typeof SendResetPasswordEmailOutputSchema
>;

export async function sendResetPasswordEmail(
  input: SendResetPasswordEmailInput
): Promise<SendResetPasswordEmailOutput> {
  return sendResetPasswordEmailFlow(input);
}


const sendResetPasswordEmailFlow = ai.defineFlow(
  {
    name: 'sendResetPasswordEmailFlow',
    inputSchema: SendResetPasswordEmailInputSchema,
    outputSchema: SendResetPasswordEmailOutputSchema,
  },
  async (input) => {
    // In a real application, you would integrate with an email service like SendGrid or Resend
    // and generate a secure, single-use token to include in the reset link.
    // For this demo, we will just log to the console and return a success message.
    
    console.log(`Password reset requested for: ${input.email}. In a real app, an email would be sent.`);

    return {
        success: true,
        message: `If an account with the email ${input.email} exists, a password reset link has been sent.`,
    };
  }
);
