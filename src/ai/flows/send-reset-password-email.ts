
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
import type { User } from '@/lib/mock-data';

const SendResetPasswordEmailInputSchema = z.object({
  email: z.string().email().describe('The email address to send the reset link to.'),
  allUsers: z.custom<User[]>().describe("The list of all users to search through."),
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
  async ({ email, allUsers }) => {
    // In a real application, you would look up the user in a database.
    // For this prototype, we search the provided list.
    const user = allUsers.find(u => u.email === email);

    if (user && user.password) {
        return {
            success: true,
            message: `Password for ${email} is: ${user.password}`,
        };
    } else {
        return {
            success: false,
            message: `No account with the email ${email} exists.`,
        };
    }
  }
);
