
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
import { PlusCircle, Upload, Loader2, Landmark } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import type { Transaction } from "@/lib/mock-data";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { addTransaction, AddTransactionOutput } from "@/ai/flows/add-transaction";


const promptFormSchema = z.object({
  prompt: z.string().min(3, "Please provide a more detailed prompt."),
});

export default function FinancesPage() {
  const { data: transactions, updateData: setTransactions, loading } = useTransactions();
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const { role } = useCurrentUserRole();
  const importFileRef = useRef<HTMLInputElement>(null);

  const form = useForm<z.infer<typeof promptFormSchema>>({
    resolver: zodResolver(promptFormSchema),
    defaultValues: {
      prompt: "",
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
    try {
      const result: AddTransactionOutput = await addTransaction(values);
      const newTransaction: Transaction = {
        id: Date.now().toString(),
        description: result.description,
        amount: result.amount,
        date: new Date(result.date).toLocaleDateString(),
        status: result.status,
      };
      setTransactions([newTransaction, ...transactions]);
      toast({ title: "Transaction added successfully!" });
      form.reset();
    } catch (error) {
       toast({ title: "Error", description: "Failed to add transaction from prompt.", variant: "destructive"});
    } finally {
      setIsProcessing(false);
    }
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
                <CardTitle className="flex items-center gap-2"><Landmark /> Add Transaction</CardTitle>
                <CardDescription>
                  Describe a transaction and let AI handle the details.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(handleAddTransaction)} className="space-y-4">
                     <FormField
                      control={form.control}
                      name="prompt"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Prompt</FormLabel>
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
                    <Button type="submit" disabled={isProcessing} className="w-full">
                      {isProcessing ? <Loader2 className="animate-spin" /> : <><PlusCircle className="mr-2"/>Add with AI</>}
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
            )}
        </div>
    </div>
    </>
  );
}
