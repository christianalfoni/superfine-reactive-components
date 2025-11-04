import { createState, createSuspense, Suspense } from "@superfine-components/core";

// Mock API functions that simulate network delay
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface User {
  id: string;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  body: string;
}

const fetchUser = async (userId: string): Promise<User> => {
  await delay(1500);
  return {
    id: userId,
    name: "John Doe",
    email: "john@example.com",
  };
};

const fetchPosts = async (_userId: string): Promise<Post[]> => {
  await delay(2000);
  return [
    { id: 1, title: "First Post", body: "This is my first post!" },
    { id: 2, title: "Second Post", body: "Learning Suspense is fun!" },
    { id: 3, title: "Third Post", body: "Render contexts are amazing!" },
  ];
};

const fetchStats = async (): Promise<{ views: number; likes: number }> => {
  await delay(1000);
  return { views: 1234, likes: 567 };
};

// Loading component shown while data is fetching
function Loading() {
  return () => (
    <div
      style="padding: 40px; text-align: center; color: #999; font-style: italic;"
    >
      <div
        style="display: inline-block; width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #4a90e2; border-radius: 50%; animation: spin 1s linear infinite;"
      />
      <p style="margin-top: 16px;">Loading...</p>
      <style>
        {`@keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }`}
      </style>
    </div>
  );
}

// User profile component that suspends while fetching data
function UserProfile(props: { userId: string }) {
  console.log('[UserProfile] SETUP PHASE - this should only run once per instance!');

  // createSuspense is called during setup phase (runs once)
  // It returns reactive state with resolved values (initially undefined)
  const data = createSuspense({
    user: fetchUser(props.userId),
    posts: fetchPosts(props.userId),
  });

  return () => (
    <div style="padding: 20px; background-color: #f9f9f9; border-radius: 8px; margin-bottom: 20px;">
      <h2 style="margin-top: 0; color: #333;">User Profile</h2>

      {/* Use optional chaining since values start as undefined */}
      <div style="margin-bottom: 16px;">
        <p style="margin: 8px 0;">
          <strong>Name:</strong> {data.user?.name}
        </p>
        <p style="margin: 8px 0;">
          <strong>Email:</strong> {data.user?.email}
        </p>
      </div>

      <h3 style="color: #555; margin-bottom: 12px;">
        Posts ({data.posts?.length || 0})
      </h3>
      <div style="display: flex; flex-direction: column; gap: 12px;">
        {data.posts?.map((post) => (
          <div style="padding: 12px; background-color: white; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);"
          >
            <h4 style="margin: 0 0 8px 0; color: #4a90e2;">{post.title}</h4>
            <p style="margin: 0; color: #666; font-size: 14px;">{post.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// Stats component that suspends independently
function Stats() {
  const data = createSuspense({
    stats: fetchStats(),
  });

  return () => (
    <div style="padding: 20px; background-color: #e8f4f8; border-radius: 8px;">
      <h2 style="margin-top: 0; color: #333;">Statistics</h2>
      <div style="display: flex; gap: 24px;">
        <div>
          <p style="margin: 0; font-size: 14px; color: #777;">Views</p>
          <p style="margin: 4px 0 0 0; font-size: 28px; font-weight: bold; color: #4a90e2;">
            {data.stats?.views.toLocaleString()}
          </p>
        </div>
        <div>
          <p style="margin: 0; font-size: 14px; color: #777;">Likes</p>
          <p style="margin: 4px 0 0 0; font-size: 28px; font-weight: bold; color: #4a90e2;">
            {data.stats?.likes.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}

// Main Suspense example component
export function SuspenseExample() {
  const state = createState({
    userId: "user-123",
    showProfile: true,
  });

  const refreshData = () => {
    // Change the key to force component recreation and new data fetch
    state.userId = `user-${Date.now()}`;
  };

  return () => (
    <div>
      <div style="margin-bottom: 20px; padding: 20px; background-color: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <h2 style="margin-top: 0; color: #333;">Suspense Demo</h2>
        <p style="color: #666; margin-bottom: 16px;">
          This example demonstrates async data fetching with Suspense.
          Components show loading states while fetching data, and the same
          component instances persist throughout (no unmounting/remounting).
        </p>

        <div style="display: flex; gap: 12px; margin-bottom: 16px;">
          <button
            onClick={refreshData}
            style="padding: 10px 20px; font-size: 16px; border: none; border-radius: 4px; background-color: #4a90e2; color: white; cursor: pointer; font-weight: 500;"
          >
            Refresh Data
          </button>

          <button
            onClick={() => (state.showProfile = !state.showProfile)}
            style="padding: 10px 20px; font-size: 16px; border: 1px solid #4a90e2; border-radius: 4px; background-color: white; color: #4a90e2; cursor: pointer; font-weight: 500;"
          >
            {state.showProfile ? "Hide" : "Show"} Profile
          </button>
        </div>

        <div style="padding: 12px; background-color: #fff9e6; border-left: 4px solid #ffcc00; border-radius: 4px;">
          <p style="margin: 0; font-size: 14px; color: #666;">
            <strong>💡 Tip:</strong> Click "Refresh Data" to see the loading states.
            The profile takes 2 seconds (waits for both user and posts), while stats
            loads independently in 1 second.
          </p>
        </div>
      </div>

      {/* Nested Suspense boundaries - each handles loading independently */}
      <div style="display: grid; grid-template-columns: 1fr; gap: 20px;">
        {state.showProfile && (
          <Suspense fallback={<Loading />}>
            {/* Key prop forces recreation when userId changes */}
            <UserProfile key={state.userId} userId={state.userId} />
          </Suspense>
        )}

        <Suspense fallback={<Loading />}>
          <Stats key={state.userId} />
        </Suspense>
      </div>

      {/* Technical details */}
      <div style="margin-top: 20px; padding: 20px; background-color: #f5f5f5; border-radius: 8px; font-size: 14px; color: #666;">
        <h3 style="margin-top: 0; color: #333; font-size: 16px;">
          🔍 What's happening behind the scenes:
        </h3>
        <ul style="margin: 8px 0; padding-left: 24px;">
          <li style="margin-bottom: 8px;">
            <code style="background-color: #fff; padding: 2px 6px; border-radius: 3px;">createSuspense()</code>
            {" "}is called during component setup (runs once)
          </li>
          <li style="margin-bottom: 8px;">
            Returns reactive state with values initially <code style="background-color: #fff; padding: 2px 6px; border-radius: 3px;">undefined</code>
          </li>
          <li style="margin-bottom: 8px;">
            Notifies nearest Suspense boundary of pending promises
          </li>
          <li style="margin-bottom: 8px;">
            Suspense shows fallback while <code style="background-color: #fff; padding: 2px 6px; border-radius: 3px;">pendingCount {'>'} 0</code>
          </li>
          <li style="margin-bottom: 8px;">
            When promises resolve, reactive state updates trigger automatic re-renders
          </li>
          <li style="margin-bottom: 8px;">
            Component instances use different render contexts (
            <code style="background-color: #fff; padding: 2px 6px; border-radius: 3px;">[children]</code> vs{" "}
            <code style="background-color: #fff; padding: 2px 6px; border-radius: 3px;">[fallback]</code>
            ) so they persist throughout
          </li>
          <li>
            No wrapper divs or CSS tricks - just clean conditional rendering!
          </li>
        </ul>
      </div>
    </div>
  );
}
