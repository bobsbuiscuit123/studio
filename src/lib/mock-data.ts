export const members = [
  {
    name: "Alice Johnson",
    role: "President",
    avatar: "https://placehold.co/100x100.png",
    email: "alice@example.com",
    dataAiHint: "woman smiling",
  },
  {
    name: "Bob Williams",
    role: "Vice President",
    avatar: "https://placehold.co/100x100.png",
    email: "bob@example.com",
    dataAiHint: "man glasses",
  },
  {
    name: "Charlie Brown",
    role: "Treasurer",
    avatar: "https://placehold.co/100x100.png",
    email: "charlie@example.com",
    dataAiHint: "man outdoors",
  },
  {
    name: "Diana Miller",
    role: "Secretary",
    avatar: "https://placehold.co/100x100.png",
    email: "diana@example.com",
    dataAiHint: "woman portrait",
  },
  {
    name: "Ethan Davis",
    role: "Member",
    avatar: "https://placehold.co/100x100.png",
    email: "ethan@example.com",
    dataAiHint: "young man",
  },
  {
    name: "Fiona Garcia",
    role: "Member",
    avatar: "https://placehold.co/100x100.png",
    email: "fiona@example.com",
    dataAiHint: "woman nature",
  },
];

export const events = [
  {
    date: new Date(new Date().getFullYear(), new Date().getMonth(), 15, 18, 0),
    title: "Monthly General Meeting",
    description: "Discussing upcoming projects and member roles.",
    location: "Room 101",
  },
  {
    date: new Date(new Date().getFullYear(), new Date().getMonth(), 22, 10, 0),
    title: "Workshop: Public Speaking",
    description: "A workshop to improve public speaking skills.",
    location: "Auditorium",
  },
  {
    date: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 5, 14, 0),
    title: "Fundraising Bake Sale",
    description: "Raising money for our next big event.",
    location: "School Courtyard",
  },
];

export const announcements = [
  {
    id: 1,
    title: "Next Meeting Reminder",
    content: "Don't forget our general meeting this Friday at 6 PM in Room 101. We'll be finalizing details for the fundraiser. See you there!",
    author: "Alice Johnson",
    date: "3 days ago",
  },
  {
    id: 2,
    title: "Volunteers Needed for Bake Sale",
    content: "We need volunteers to help with the bake sale next month. Please sign up using the link shared in the group chat. Your support is crucial!",
    author: "Alice Johnson",
    date: "1 week ago",
  },
];

export const socialPosts = [
  {
    id: 1,
    platform: "Instagram",
    content: "Throwback to our amazing team-building event last month! 🎉 Great memories and even greater people. #ClubLife #TeamBuilding",
    image: "https://placehold.co/400x400.png",
    dataAiHint: "team students",
    author: "AI Assistant",
    date: "2 days ago",
  },
  {
    id: 2,
    platform: "Twitter",
    content: "Our public speaking workshop was a huge success! Thanks to everyone who participated. Stay tuned for more events like this! #PublicSpeaking #StudentClub",
    image: "https://placehold.co/400x200.png",
    dataAiHint: "presentation students",
    author: "AI Assistant",
    date: "5 days ago",
  },
];

export const transactions = [
  {
    id: "txn_1",
    description: "Member Dues - Bob Williams",
    amount: 20.0,
    date: "2024-05-01",
    status: "Paid",
  },
  {
    id: "txn_2",
    description: "Fundraiser Ticket - Fiona Garcia",
    amount: 10.0,
    date: "2024-05-05",
    status: "Paid",
  },
  {
    id: "txn_3",
    description: "Club T-Shirt Order",
    amount: -150.0,
    date: "2024-05-10",
    status: "Paid",
  },
  {
    id: "txn_4",
    description: "Member Dues - Ethan Davis",
    amount: 20.0,
    date: "2024-05-12",
    status: "Pending",
  },
    {
    id: "txn_5",
    description: "Bake Sale Revenue",
    amount: 250.50,
    date: "2024-05-20",
    status: "Paid",
  },
];
