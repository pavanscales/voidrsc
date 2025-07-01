import { jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// Simulate fetching user data (replace with real DB/API call)
async function fetchUser(id) {
    // Simulated async user fetch delay
    await new Promise((r) => setTimeout(r, 10));
    return { id, name: `User ${id}`, bio: 'This is a sample user profile.' };
}
export default async function UserPage({ params }) {
    const user = await fetchUser(params.id);
    return (_jsxs(_Fragment, { children: [_jsxs("h1", { children: ["User Profile: ", user.name] }), _jsxs("p", { children: ["ID: ", user.id] }), _jsxs("p", { children: ["Bio: ", user.bio] })] }));
}
