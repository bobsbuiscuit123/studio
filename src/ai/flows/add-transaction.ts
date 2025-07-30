
'use server';

/**
 * @fileOverview Creates a financial transaction using AI from a natural language prompt.
 *
 * - addTransaction - A function that creates a transaction.
 * - AddTransactionInput - The input type for the addTransaction function.
 * - AddTransactionOutput - The return type for the addTransaction function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AddTransactionInputSchema = z.object({
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
): Promise<AddTransactionOutput> {
  return addTransactionFlow(input);
}


const addTransactionPrompt = ai.definePrompt({
    name: "addTransactionPrompt",
    input: {schema: AddTransactionInputSchema},
    output: {schema: AddTransactionOutputSchema},
    prompt: `You are an expert at parsing natural language to create financial transactions.
    The user will provide a prompt, and you must extract the transaction details and format them correctly.
    - Determine if the transaction is income (positive amount) or an expense (negative amount).
    - If the status (Paid or Pending) is not mentioned, assume it is 'Paid'.
    
    Prompt: {{{prompt}}}
    
    The current date is ${new Date().toDateString()}. Use this for context when interpreting relative dates like "yesterday" or "last Friday".
    `
});


const addTransactionFlow = ai.defineFlow(
  {
    name: 'addTransactionFlow',
    inputSchema: AddTransactionInputSchema,
    outputSchema: AddTransactionOutputSchema,
  },
  async input => {
    const { output } = await addTransactionPrompt(input);
    if (!output) {
        throw new Error("Could not generate transaction from prompt.");
    }
    return output;
  }
);
