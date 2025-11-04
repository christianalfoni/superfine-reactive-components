import { createState, createSuspense, Suspense } from '@superfine-components/core';

// Mock API functions that return promises
function fetchUser(userId: string): Promise<{ id: string; name: string; email: string }> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        id: userId,
        name: `User ${userId}`,
        email: `user${userId}@example.com`,
      });
    }, 1500);
  });
}

function fetchPosts(userId: string): Promise<{ id: string; title: string }[]> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve([
        { id: '1', title: 'First Post' },
        { id: '2', title: 'Second Post' },
        { id: '3', title: 'Third Post' },
      ]);
    }, 2000);
  });
}

function fetchComments(postId: string): Promise<{ id: string; text: string }[]> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve([
        { id: '1', text: 'Great post!' },
        { id: '2', text: 'Thanks for sharing!' },
      ]);
    }, 1000);
  });
}

// Component that uses createSuspense
function UserProfile(props: { userId: string }) {
  const data = createSuspense({
    user: fetchUser(props.userId),
    posts: fetchPosts(props.userId),
  });

  return () => (
    <div style="border: 1px solid #ddd; padding: 20px; margin: 10px; border-radius: 8px;">
      <h2>User Profile</h2>
      <div>
        <strong>Name:</strong> {data.user?.name || 'Loading...'}
      </div>
      <div>
        <strong>Email:</strong> {data.user?.email || 'Loading...'}
      </div>
      <div>
        <strong>Posts:</strong> {data.posts?.length || 0}
      </div>
      {data.posts && (
        <ul>
          {data.posts.map((post) => (
            <li key={post.id}>{post.title}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Another component with faster loading
function QuickStats() {
  const data = createSuspense({
    stats: new Promise<{ views: number; likes: number }>((resolve) => {
      setTimeout(() => {
        resolve({ views: 1234, likes: 567 });
      }, 500);
    }),
  });

  return () => (
    <div style="border: 1px solid #ddd; padding: 20px; margin: 10px; border-radius: 8px; background: #f9f9f9;">
      <h3>Quick Stats</h3>
      <div>Views: {data.stats?.views || '...'}</div>
      <div>Likes: {data.stats?.likes || '...'}</div>
    </div>
  );
}

// Component with nested Suspense
function PostWithComments(props: { postId: string }) {
  const data = createSuspense({
    comments: fetchComments(props.postId),
  });

  return () => (
    <div style="margin-left: 20px; padding: 10px; background: #f5f5f5; border-radius: 4px;">
      <h4>Comments ({data.comments?.length || 0})</h4>
      {data.comments && (
        <ul>
          {data.comments.map((comment) => (
            <li key={comment.id}>{comment.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Main example component
export function SuspenseExample() {
  const state = createState({
    userId: '123',
    showNested: false,
  });

  return () => (
    <div style="padding: 20px; font-family: sans-serif;">
      <h1>Suspense Example</h1>
      <p>
        This demonstrates async data loading with <code>createSuspense()</code> and{' '}
        <code>&lt;Suspense&gt;</code>
      </p>

      <div style="margin: 20px 0;">
        <button
          onClick={() => {
            state.userId = state.userId === '123' ? '456' : '123';
          }}
          style="padding: 10px 20px; margin-right: 10px; cursor: pointer;"
        >
          Toggle User ID (Current: {state.userId})
        </button>
        <button
          onClick={() => {
            state.showNested = !state.showNested;
          }}
          style="padding: 10px 20px; cursor: pointer;"
        >
          {state.showNested ? 'Hide' : 'Show'} Nested Suspense
        </button>
      </div>

      <h2>Single Suspense Boundary</h2>
      <Suspense
        fallback={
          <div style="padding: 20px; background: #fffbea; border: 2px dashed #f59e0b; border-radius: 8px;">
            ⏳ Loading user profile...
          </div>
        }
      >
        {/* Key prop forces recreation when userId changes */}
        <UserProfile key={state.userId} userId={state.userId} />
      </Suspense>

      <h2>Separate Suspense Boundaries</h2>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <Suspense
          fallback={
            <div style="padding: 20px; background: #fffbea; border: 2px dashed #f59e0b; border-radius: 8px;">
              ⏳ Loading profile...
            </div>
          }
        >
          <UserProfile key={`alt-${state.userId}`} userId={state.userId} />
        </Suspense>

        <Suspense
          fallback={
            <div style="padding: 20px; background: #fffbea; border: 2px dashed #f59e0b; border-radius: 8px;">
              ⏳ Loading stats...
            </div>
          }
        >
          <QuickStats />
        </Suspense>
      </div>

      {state.showNested && (
        <>
          <h2>Nested Suspense</h2>
          <Suspense
            fallback={
              <div style="padding: 20px; background: #fffbea; border: 2px dashed #f59e0b; border-radius: 8px;">
                ⏳ Loading outer boundary...
              </div>
            }
          >
            <div style="border: 2px solid #3b82f6; padding: 20px; margin: 10px; border-radius: 8px;">
              <h3>Outer Boundary</h3>
              <QuickStats />

              <Suspense
                fallback={
                  <div style="padding: 20px; background: #dbeafe; border: 2px dashed #3b82f6; border-radius: 8px; margin: 10px;">
                    ⏳ Loading inner boundary (comments)...
                  </div>
                }
              >
                <PostWithComments postId="1" />
              </Suspense>
            </div>
          </Suspense>
        </>
      )}

      <div style="margin-top: 40px; padding: 20px; background: #f3f4f6; border-radius: 8px;">
        <h3>How it works:</h3>
        <ul>
          <li>
            <code>createSuspense()</code> is called during component setup with promises
          </li>
          <li>Returns a reactive state object (values are undefined until resolved)</li>
          <li>Suspense boundary shows fallback while any child is loading</li>
          <li>When promises resolve, components re-render with real data</li>
          <li>Changing the userId with key prop forces component recreation</li>
          <li>Each Suspense boundary manages its own loading state independently</li>
        </ul>
      </div>
    </div>
  );
}
