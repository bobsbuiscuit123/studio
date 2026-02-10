
/**
 * @fileOverview Creates a financial transaction using AI from a natural language prompt.
 *
 * - addTransaction - A function that creates a transaction.
 * - AddTransactionInput - The input type for the addTransaction function.
 * - AddTransactionOutput - The return type for the addTransaction function.
 */

import { callAI } from '@/ai/genkit';
import { type Result } from '@/lib/result';
import { z } from 'zod';

export const AddTransactionInputSchema = z.object({
  prompt: z.string().describe('A natural language prompt describing the transaction. For example: "Received $50 for member dues yesterday" or "Spent $25 on pizza for the meeting last Friday, it has been paid."'),
});
export type AddTransactionInput = z.infer<
  typeof AddTransactionInputSchema
>;

const AddTransactionOutputSchema = z.object({
    description: z.string().describe('A concise description of the transaction.'),
    amount: z.number().describe('The amount of the transaction. Should be positive for income and negative for expenses.'),
    date: z.string().describe('The date of the transaction in a machine-readable format like an ISO string. The current year is 2024.'),
    status: z.enum(['Paid', 'Pending']).describe('The status of the transaction.'),
}).describe("The transaction that was created.");
export type AddTransactionOutput = z.infer<
  typeof AddTransactionOutputSchema
>;

export async function addTransaction(
  input: AddTransactionInput
): Promise<Result<AddTransactionOutput>> {
  const today = new Date();
  const result = await callAI<AddTransactionOutput>({
    responseFormat: 'json_object',
    outputSchema: AddTransactionOutputSchema,
    messages: [
      {
        role: 'system',
        content: `You are an expert at parsing natural language to create financial transactions.
The user will provide a prompt, and you must extract the transaction details and format them correctly.
- Determine if the transaction is income (positive amount) or an expense (negative amount).
- If the status (Paid or Pending) is not mentioned, assume it is "Paid".
The current date is ${today.toDateString()}. Use this for context when interpreting relative dates like "yesterday" or "last Friday".
The current year is ${today.getFullYear()}.
Return ONLY valid JSON matching: { "description": string, "amount": number, "date": string, "status": "Paid" | "Pending" }.
The "date" must be a machine-readable ISO string.`,
      },
      {
        role: 'user',
        content: input.prompt,
      },
    ],
  });
  return result;
}
