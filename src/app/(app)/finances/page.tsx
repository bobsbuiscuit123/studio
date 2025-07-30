
"use client";

import { useState } from "react";
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
import { PlusCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import type { Transaction } from "@/lib/mock-data";


const transactionFormSchema = z.object({
  description: z.string().min(3, "Description must be at least 3 characters long."),
  amount: z.coerce.number().refine(val => val !== 0, { message: "Amount cannot be zero." }),
  date: z.string().refine(val => !isNaN(Date.parse(val)), { message: "Please select a valid date."}),
  status: z.enum(['Paid', 'Pending']),
});

export default function FinancesPage() {
  const { data: transactions, updateData: setTransactions, loading } = useTransactions();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { toast } = useToast();
  const { isOwner } = useCurrentUserRole();

  const form = useForm<z.infer<typeof transactionFormSchema>>({
    resolver: zodResolver(transactionFormSchema),
    defaultValues: {
      description: "",
      amount: 0,
      date: new Date().toISOString().split('T')[0],
      status: "Paid",
    },
  });

  const handleAddTransaction = (values: z.infer<typeof transactionFormSchema>) => {
    const newTransaction: Transaction = {
      id: Date.now().toString(),
      description: values.description,
      amount: values.amount,
      date: new Date(values.date).toLocaleDateString(),
      status: values.status,
    };
    setTransactions([newTransaction, ...transactions]);
    toast({ title: "Transaction added successfully!" });
    form.reset();
    setIsDialogOpen(false);
  };

  const totalIncome = transactions
    .filter((t) => t.amount > 0)
    .reduce((acc, t) => acc + t.amount, 0);
  const totalExpenses = transactions
    .filter((t) => t.amount < 0)
    .reduce((acc, t) => acc + t.amount, 0);
  const netBalance = totalIncome + totalExpenses;
  
  return (
    <>
    <div className="flex flex-col gap-4">
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
                Manually track your club's income and expenses.
              </CardDescription>
            </div>
             {isOwner && (
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogTrigger asChild>
                    <Button><PlusCircle className="mr-2"/> Add Transaction</Button>
                    </DialogTrigger>
                    <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add a New Transaction</DialogTitle>
                        <DialogDescription>
                        Enter the details for the transaction. Use a negative number for expenses.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={form.handleSubmit(handleAddTransaction)} className="space-y-4">
                        <div>
                        <Label htmlFor="description">Description</Label>
                        <Input id="description" {...form.register('description')} />
                        {form.formState.errors.description && <p className="text-red-500 text-sm">{form.formState.errors.description.message}</p>}
                        </div>
                        <div>
                        <Label htmlFor="amount">Amount</Label>
                        <Input id="amount" type="number" step="0.01" {...form.register('amount')} />
                        {form.formState.errors.amount && <p className="text-red-500 text-sm">{form.formState.errors.amount.message}</p>}
                        </div>
                        <div>
                        <Label htmlFor="date">Date</Label>
                        <Input id="date" type="date" {...form.register('date')} />
                        {form.formState.errors.date && <p className="text-red-500 text-sm">{form.formState.errors.date.message}</p>}
                        </div>
                        <div>
                        <Label>Status</Label>
                        <RadioGroup
                            defaultValue={form.getValues('status')}
                            onValueChange={(value) => form.setValue('status', value as 'Paid' | 'Pending')}
                            className="flex gap-4 mt-2"
                        >
                            <div className="flex items-center space-x-2">
                            <RadioGroupItem value="Paid" id="paid" />
                            <Label htmlFor="paid">Paid</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                            <RadioGroupItem value="Pending" id="pending" />
                            <Label htmlFor="pending">Pending</Label>
                            </div>
                        </RadioGroup>
                        {form.formState.errors.status && <p className="text-red-500 text-sm">{form.formState.errors.status.message}</p>}
                        </div>
                        <DialogFooter>
                            <DialogClose asChild>
                            <Button type="button" variant="ghost">Cancel</Button>
                            </DialogClose>
                            <Button type="submit">Add Transaction</Button>
                        </DialogFooter>
                    </form>
                    </DialogContent>
                </Dialog>
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
    </>
  );
}
