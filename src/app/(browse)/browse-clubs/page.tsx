
"use client";

import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type Club = {
  id: string;
  name: string;
  category: string;
  description: string;
  logo: string;
};

const clubCategories = ["All", "STEM", "Arts", "Sports", "Service", "Academic", "Cultural", "Other"];

function ClubCard({ club }: { club: Club }) {
    return (
        <Card className="flex flex-col">
            <CardHeader className="flex-row items-center gap-4">
                <Image src={club.logo} alt={`${club.name} logo`} width={64} height={64} className="rounded-lg aspect-square object-cover" />
                <div>
                    <CardTitle>{club.name}</CardTitle>
                    <CardDescription><Badge variant="secondary">{club.category}</Badge></CardDescription>
                </div>
            </CardHeader>
            <CardContent className="flex-grow">
                <p className="text-sm text-muted-foreground line-clamp-2">{club.description}</p>
            </CardContent>
            <CardFooter>
                <Link href={`/browse-clubs/${club.id}`} className="w-full">
                    <Button className="w-full">View Profile</Button>
                </Link>
            </CardFooter>
        </Card>
    );
}


export default function BrowseClubsPage() {
    const [allClubs, setAllClubs] = useState<Club[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [isClient, setIsClient] = useState(false);

    useEffect(() => {
        setIsClient(true);
        const clubsString = localStorage.getItem('clubs');
        if (clubsString) {
            const clubsFromStorage = JSON.parse(clubsString);
            const clubsWithDetails = clubsFromStorage.map((c: any) => {
                 const clubDataString = localStorage.getItem(`club_${c.id}`);
                 const clubData = clubDataString ? JSON.parse(clubDataString) : {};
                 return {
                     ...c,
                     logo: clubData.logo || `https://placehold.co/100x100.png?text=${c.name.charAt(0)}`,
                     description: c.description || 'No description provided.'
                 }
            });
            setAllClubs(clubsWithDetails);
        }
    }, []);

    const filteredClubs = useMemo(() => {
        return allClubs.filter(club => {
            const matchesCategory = selectedCategory === 'All' || club.category === selectedCategory;
            const matchesSearch = club.name.toLowerCase().includes(searchTerm.toLowerCase());
            return matchesCategory && matchesSearch;
        });
    }, [allClubs, searchTerm, selectedCategory]);

    if (!isClient) {
        return <div>Loading Club Directory...</div>;
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold">Club Directory</h1>
                <p className="text-muted-foreground">Discover and join clubs at your school.</p>
            </div>

            <div className="flex flex-col md:flex-row gap-4">
                <div className="relative flex-grow">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search for a club..."
                        className="pl-10"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                 <Tabs value={selectedCategory} onValueChange={setSelectedCategory}>
                    <TabsList className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 w-full md:w-auto">
                        {clubCategories.map(category => (
                            <TabsTrigger key={category} value={category}>{category}</TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
            </div>

            {filteredClubs.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {filteredClubs.map(club => (
                        <ClubCard key={club.id} club={club} />
                    ))}
                </div>
            ) : (
                <div className="text-center py-16 border-2 border-dashed rounded-lg">
                    <p className="text-muted-foreground">No clubs found matching your criteria.</p>
                </div>
            )}
        </div>
    );
}
