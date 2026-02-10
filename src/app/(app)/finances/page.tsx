
"use client";

import { useState, useRef } from "react";
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
import { useTransactions, useCurrentUserRole } from "@/lib/data-hooks";
import { Button } from "@/components/ui/button";
import { PlusCircle, Upload, Loader2, Landmark, Sparkles } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import type { Transaction } from "@/lib/mock-data";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { safeFetchJson } from "@/lib/network";


const promptFormSchema = z.object({
  prompt: z.string().min(3, "Please provide a more detailed prompt."),
});
const manualFormSchema = z.object({
  description: z.string().min(3, "Description is required."),
  amount: z.number({ invalid_type_error: "Enter a number" }),
  date: z.string().optional(),
  status: z.enum(['Paid', 'Pending']).default('Paid'),
});

export default function FinancesPage() {
  const { data: transactions, updateData: setTransactions, loading } = useTransactions();
  const [isProcessing, setIsProcessing] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const { toast } = useToast();
  const { role } = useCurrentUserRole();
  const importFileRef = useRef<HTMLInputElement>(null);
  const aiSparkle = "bg-gradient-to-r from-emerald-500 via-emerald-500 to-emerald-600 text-white shadow-[0_0_12px_rgba(16,185,129,0.35)]";

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
      status: "Paid",
    },
  });
  
  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      try {
        const lines = text.split('\n').slice(1); // Skip header row
        const newTransactions: Transaction[] = lines
          .map(line => {
            const [date, description, amountStr] = line.split(',');
            if (!date || !description || !amountStr) return null;
            
            const amount = parseFloat(amountStr);
            if (isNaN(amount)) return null;

            return {
              id: `${Date.now()}-${Math.random()}`,
              date: new Date(date).toLocaleDateString(),
              description: description.trim(),
              amount: amount,
              status: 'Paid',
            } as Transaction;
          })
          .filter((t): t is Transaction => t !== null);
        
        if (newTransactions.length > 0) {
            setTransactions([...newTransactions, ...transactions]);
            toast({ title: "Import Successful", description: `${newTransactions.length} transactions were imported.`});
        } else {
            toast({ title: "Import Failed", description: "Could not find any valid transactions in the file. Please ensure it is a CSV with Date,Description,Amount columns.", variant: "destructive" });
        }

      } catch (error) {
        toast({ title: "Import Error", description: "Failed to parse the CSV file.", variant: "destructive"});
        console.error("CSV parsing error:", error);
      }
    };
    reader.readAsText(file);
    
    // Reset file input
    if(event.target) event.target.value = '';
  };


  const handleAddTransaction = async (values: z.infer<typeof promptFormSchema>) => {
    setIsProcessing(true);
    const result = await safeFetchJson<{ ok: boolean; data?: { description: string; amount: number; date: string; status: 'Paid' | 'Pending' }; error?: { message?: string } }>(
      '/api/finances/ai',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
        timeoutMs: 12_000,
        retry: { retries: 1 },
      }
    );
    if (!result.ok || !result.data?.ok || !result.data.data) {
      toast({
        title: "Error",
        description: result.ok ? result.data?.error?.message || "Failed to add transaction from prompt." : result.error.message,
        variant: "destructive",
      });
      setIsProcessing(false);
      return;
    }
    const newTransaction: Transaction = {
      id: Date.now().toString(),
      description: result.data.data.description,
      amount: result.data.data.amount,
      date: new Date(result.data.data.date).toLocaleDateString(),
      status: result.data.data.status,
    };
    setTransactions([newTransaction, ...transactions]);
    toast({ title: "Transaction added successfully!" });
    form.reset();
    setIsProcessing(false);
  };
  
  const handleManualAdd = (values: z.infer<typeof manualFormSchema>) => {
    const newTransaction: Transaction = {
      id: Date.now().toString(),
      description: values.description,
      amount: values.amount,
      date: values.date ? new Date(values.date).toLocaleDateString() : new Date().toLocaleDateString(),
      status: values.status,
    };
    setTransactions([newTransaction, ...transactions]);
    toast({ title: "Transaction added manually!" });
    manualForm.reset({ description: "", amount: 0, status: "Paid" });
  };

  const totalIncome = transactions
    .filter((t) => t.amount > 0)
    .reduce((acc, t) => acc + t.amount, 0);
  const totalExpenses = transactions
    .filter((t) => t.amount < 0)
    .reduce((acc, t) => acc + t.amount, 0);
  const netBalance = totalIncome + totalExpenses;

  if (role !== 'President' && role !== 'Admin') {
    return (
        <div className="flex items-center justify-center h-full">
            <Card className="p-8 text-center">
                <CardTitle>Access Denied</CardTitle>
                <CardDescription>This page is only available to club Presidents and Admins.</CardDescription>
            </Card>
        </div>
    )
  }
  
  return (
    <>
    <div className="grid gap-8 md:grid-cols-3">
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
                        Track your club's income and expenses. Import from RevTrak or add manually.
                    </CardDescription>
                    </div>
                    {(role === 'President' || role === 'Admin') && (
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => importFileRef.current?.click()}>
                                <Upload className="mr-2"/> Import from RevTrak
                            </Button>
                            <Input 
                                type="file" 
                                ref={importFileRef}
                                className="hidden"
                                accept=".csv"
                                onChange={handleFileImport}
                            />
                        </div>
                    )}
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
                                transaction.status === "Paid" ? "default" : "secondary"
                            }
                            className={cn(
                                transaction.status === "Paid" && "bg-green-100 text-green-800",
                                transaction.status === "Pending" && "bg-yellow-100 text-yellow-800"
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
                    <div className="text-center py-16 text-muted-foreground">
                        <p>No transactions yet. Add one to get started!</p>
                    </div>
                )
                }
                </CardContent>
            </Card>
        </div>
        <div className="md:col-span-1">
             {(role === 'President' || role === 'Admin') && (
             <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2"><Landmark /> Add Transaction</CardTitle>
                    <CardDescription>Enter details manually, or ask AI to fill them.</CardDescription>
                  </div>
                  <Button type="button" variant="ghost" className={aiSparkle} onClick={() => setShowAi(v => !v)}>
                    <Sparkles className="h-4 w-4 mr-1" /> {showAi ? 'Hide AI' : 'Make with AI'}
                  </Button>
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
                              <select
                                className="w-full rounded-md border px-2 py-2"
                                value={field.value}
                                onChange={e => field.onChange(e.target.value as any)}
                              >
                                <option value="Paid">Paid</option>
                                <option value="Pending">Pending</option>
                              </select>
                            </FormControl>
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
                              <FormLabel>AI prompt</FormLabel>
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
                          {isProcessing ? <Loader2 className="animate-spin" /> : <><Sparkles className="mr-2" /> Add with AI</>}
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
    </>
  );
}
