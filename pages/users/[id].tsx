// pages/users/[id].tsx
import React from 'react';

type Props = {
  params: { id: string };
};

// Simulate fetching user data (replace with real DB/API call)
async function fetchUser(id: string) {
  // Simulated async user fetch delay
  await new Promise((r) => setTimeout(r, 10));
  return { id, name: `User ${id}`, bio: 'This is a sample user profile.' };
}

export default async function UserPage({ params }: Props) {
  const user = await fetchUser(params.id);

  return (
    <>
      <h1>User Profile: {user.name}</h1>
      <p>ID: {user.id}</p>
      <p>Bio: {user.bio}</p>
    </>
  );
}
