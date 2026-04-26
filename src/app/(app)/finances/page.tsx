
"use client";

import { useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { notifyOrgAiUsageChanged, useTransactions, useCurrentUserRole } from "@/lib/data-hooks";
import { Button } from "@/components/ui/button";
import { PlusCircle, Loader2, Landmark, Sparkles } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import type { Transaction } from "@/lib/mock-data";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { openAssistantWithContext } from "@/lib/assistant/prefill";
import { AssistantInlineTrigger } from "@/components/assistant/assistant-inline-trigger";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";


const promptFormSchema = z.object({
  prompt: z.string().min(3, "Please provide a more detailed prompt."),
});
const manualFormSchema = z.object({
  description: z.string().min(3, "Description is required."),
  amount: z.number({ invalid_type_error: "Enter a number" }),
  date: z.string().optional(),
  status: z.enum(['Deposit', 'Withdrawal']).default('Deposit'),
});

export default function FinancesPage() {
  const { data: transactions, updateData: setTransactions, loading } = useTransactions();
  const [isProcessing, setIsProcessing] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const aiRequestInFlightRef = useRef(false);
  const { toast } = useToast();
  const { role } = useCurrentUserRole();
  const aiSparkle = "bg-gradient-to-r from-emerald-500 via-emerald-500 to-emerald-600 text-white shadow-[0_0_12px_rgba(16,185,129,0.35)]";
  const openFinanceAssistant = (prompt: string) => {
    openAssistantWithContext(prompt);
  };

  const form = useForm<z.infer<typeof promptFormSchema>>({
    resolver: zodResolver(promptFormSchema),
    defaultValues: {
      prompt: "",
    },
  });
  const manualForm = useForm<z.infer<typeof manualFormSchema>>({
    resolver: zodResolver(manualFormSchema),
    defaultValues: {
      description: "",
      amount: 0,
      status: "Deposit",
    },
  });
  
  const handleAddTransaction = async (values: z.infer<typeof promptFormSchema>) => {
    openFinanceAssistant(values.prompt);
    form.reset();
    setShowAi(false);
  };
  
  const handleManualAdd = (values: z.infer<typeof manualFormSchema>) => {
    const normalizedAmount =
      values.status === 'Deposit'
        ? Math.abs(values.amount)
        : -Math.abs(values.amount);
    const newTransaction: Transaction = {
      id: Date.now().toString(),
      description: values.description,
      amount: normalizedAmount,
      date: values.date ? new Date(values.date).toLocaleDateString() : new Date().toLocaleDateString(),
      status: values.status,
    };
    setTransactions([newTransaction, ...transactions]);
    toast({ title: "Transaction added manually!" });
    manualForm.reset({ description: "", amount: 0, status: "Deposit" });
  };

  const totalIncome = transactions
    .filter((t) => t.amount > 0)
    .reduce((acc, t) => acc + t.amount, 0);
  const totalExpenses = transactions
    .filter((t) => t.amount < 0)
    .reduce((acc, t) => acc + t.amount, 0);
  const netBalance = totalIncome + totalExpenses;

  if (role !== 'Admin') {
    return (
        <div className="tab-page-shell">
            <div className="tab-page-content">
            <Card className="p-8 text-center">
                <CardTitle>Access Denied</CardTitle>
                <CardDescription>This page is only available to group admins.</CardDescription>
            </Card>
            </div>
        </div>
    )
  }
  
  return (
    <>
    <div className="tab-page-shell">
      <div className="tab-page-content">
    <div className="grid gap-4 pt-2 md:grid-cols-3 md:gap-6">
        <div className="md:col-span-2 space-y-8">
            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                <CardHeader>
                    <CardTitle>Total Income</CardTitle>
                    <CardDescription>Revenue from dues and fundraisers.</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-3xl font-bold text-green-600">${totalIncome.toFixed(2)}</p>
                </CardContent>
                </Card>
                <Card>
                <CardHeader>
                    <CardTitle>Total Expenses</CardTitle>
                    <CardDescription>Costs for events and materials.</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-3xl font-bold text-red-600">${Math.abs(totalExpenses).toFixed(2)}</p>
                </CardContent>
                </Card>
                <Card>
                <CardHeader>
                    <CardTitle>Net Balance</CardTitle>
                    <CardDescription>Current club treasury balance.</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-3xl font-bold">${netBalance.toFixed(2)}</p>
                </CardContent>
                </Card>
            </div>
            <Card>
                <CardHeader className="flex flex-row justify-between items-center">
                    <div>
                    <CardTitle>Transaction History</CardTitle>
                    <CardDescription>
                        Track your club's income and expenses.
                    </CardDescription>
                    </div>
                </CardHeader>
                <CardContent>
                {loading ? <p>Loading...</p> : 
                    transactions.length > 0 ? (
                <Table>
                    <TableHeader>
                    <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                    </TableRow>
                    </TableHeader>
                    <TableBody>
                    {[...transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((transaction) => (
                        <TableRow key={transaction.id}>
                        <TableCell className="font-medium">
                            {transaction.description}
                        </TableCell>
                        <TableCell
                            className={cn(
                            "text-right font-mono",
                            transaction.amount > 0 ? "text-green-600" : "text-red-600"
                            )}
                        >
                            {transaction.amount > 0 ? "+" : ""}${transaction.amount.toFixed(2)}
                        </TableCell>
                        <TableCell>{transaction.date}</TableCell>
                        <TableCell>
                            <Badge
                            variant={
                                transaction.status === "Deposit" ? "default" : "secondary"
                            }
                            className={cn(
                                transaction.status === "Deposit" && "bg-green-100 text-green-800",
                                transaction.status === "Withdrawal" && "bg-red-100 text-red-800"
                            )}
                            >
                            {transaction.status}
                            </Badge>
                        </TableCell>
                        </TableRow>
                    ))}
                    </TableBody>
                </Table>
                ) : (
                    <div className="tab-empty-state text-muted-foreground">
                        <p>No transactions yet. Add one to get started!</p>
                    </div>
                )
                }
                </CardContent>
            </Card>
        </div>
        <div className="md:col-span-1">
             {role === 'Admin' && (
              <Card>
                <CardHeader>
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <CardTitle className="flex items-center gap-2"><Landmark /> Add Transaction</CardTitle>
                    <AssistantInlineTrigger
                      onClick={() => {
                        setShowAi(false);
                        openFinanceAssistant("Create a transaction draft regarding the following:");
                      }}
                    />
                  </div>
                    <CardDescription>Enter details manually, or ask AI to fill them.</CardDescription>
                  </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <Form {...manualForm}>
                    <form onSubmit={manualForm.handleSubmit(handleManualAdd)} className="space-y-4">
                      <FormField
                        control={manualForm.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Description</FormLabel>
                            <FormControl>
                              <Input placeholder="Membership dues" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={manualForm.control}
                        name="amount"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Amount</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.01"
                                value={field.value ?? ''}
                                onChange={e => field.onChange(parseFloat(e.target.value))}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={manualForm.control}
                        name="date"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Date</FormLabel>
                            <FormControl>
                              <Input type="date" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={manualForm.control}
                        name="status"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Status</FormLabel>
                            <FormControl>
                              <Select value={field.value} onValueChange={field.onChange}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select transaction type" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Deposit">Deposit</SelectItem>
                                  <SelectItem value="Withdrawal">Withdrawal</SelectItem>
                                </SelectContent>
                              </Select>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button type="submit" className="w-full">
                        <PlusCircle className="mr-2" /> Add manually
                      </Button>
                    </form>
                  </Form>

                  {showAi && (
                    <Form {...form}>
                      <form onSubmit={form.handleSubmit(handleAddTransaction)} className="space-y-4">
                        <FormField
                          control={form.control}
                          name="prompt"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Assistant prompt</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="e.g., 'Received $50 for member dues yesterday' or 'Spent $25 on pizza for the meeting last Friday, it has been paid.'"
                                  
                                  className="min-h-[150px]"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button type="submit" disabled={isProcessing} className={`w-full ${aiSparkle}`}>
                          {isProcessing ? <Loader2 className="animate-spin" /> : <><Sparkles className="mr-2" /> Continue in Assistant</>}
                        </Button>
                      </form>
                    </Form>
                  )}
                </div>
              </CardContent>
            </Card>
            )}
        </div>
    </div>
      </div>
    </div>
    </>
  );
}
