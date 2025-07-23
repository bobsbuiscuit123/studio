"use client";

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
import { useTransactions } from "@/lib/data-hooks";
import { Button } from "@/components/ui/button";
import { PlusCircle } from "lucide-react";

export default function FinancesPage() {
  const { data: transactions, loading } = useTransactions();

  const totalIncome = transactions
    .filter((t) => t.amount > 0)
    .reduce((acc, t) => acc + t.amount, 0);
  const totalExpenses = transactions
    .filter((t) => t.amount < 0)
    .reduce((acc, t) => acc + t.amount, 0);
  const netBalance = totalIncome + totalExpenses;

  return (
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
             <Button disabled><PlusCircle className="mr-2"/> Add Transaction</Button>
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
              {transactions.map((transaction) => (
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
                    {transaction.amount > 0 ? "+" : ""}${Math.abs(transaction.amount).toFixed(2)}
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
  );
}
