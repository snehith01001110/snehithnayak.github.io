const BASE_URL = 'https://snehithn-server.onrender.com';

let sessionToken = localStorage.getItem('sessionToken') || null;

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  const postForm = document.getElementById('postForm');
  const logoutBtn = document.getElementById('logoutBtn');
  
  // Update UI based on current session
  updateUI();
  
  // Only fetch posts if there's an active session
  if (sessionToken) {
    loadPosts();
  }

  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value.trim();
      login(username, password);
    });
  }

  if (postForm) {
    postForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = document.getElementById('postTitle').value.trim();
      const body = document.getElementById('postBody').value.trim();
      createPost(title, body);
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      logout();
    });
  }
});

function updateUI() {
  const loginSection = document.getElementById('loginSection');
  const postSection = document.getElementById('postSection');
  const logoutSection = document.getElementById('logoutSection');
  const postList = document.getElementById('postList');

  if (sessionToken) {
    // Logged in
    loginSection.style.display = 'none';
    postSection.style.display = 'block';
    logoutSection.style.display = 'block';
  } else {
    // Logged out
    loginSection.style.display = 'block';
    postSection.style.display = 'none';
    logoutSection.style.display = 'none';
    // Clear the posts if you don't want them visible after logout:
    postList.innerHTML = '';
  }
}

function login(username, password) {
  fetch(`${BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      sessionToken = data.sessionToken;
      localStorage.setItem('sessionToken', sessionToken);
      updateUI();
      // Now that we're logged in, fetch the posts
      loadPosts();
    } else {
      alert(data.message || 'Login failed.');
    }
  })
  .catch(err => console.error(err));
}

function logout() {
  fetch(`${BASE_URL}/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionToken })
  })
  .then(res => res.json())
  .then(() => {
    sessionToken = null;
    localStorage.removeItem('sessionToken');
    updateUI();
    // Optionally, do NOT call loadPosts() here so posts stay hidden
  })
  .catch(err => console.error(err));
}

function loadPosts() {
  if (!sessionToken) {
    // If not logged in, do nothing
    return;
  }
  fetch(`${BASE_URL}/posts`)
  .then(res => res.json())
  .then(posts => {
    renderPosts(posts);
  })
  .catch(err => console.error(err));
}

function renderPosts(posts) {
  const postList = document.getElementById('postList');
  if (!postList) return;

  postList.innerHTML = '';

  posts.forEach(post => {
    const postItem = document.createElement('div');
    postItem.classList.add('post-item');

    const meta = document.createElement('div');
    meta.classList.add('post-meta');
    meta.innerText = `${post.timestamp} | ${post.username}`;

    const titleEl = document.createElement('h3');
    titleEl.innerText = post.title;

    const bodyEl = document.createElement('p');
    bodyEl.innerText = post.body;

    postItem.appendChild(meta);
    postItem.appendChild(titleEl);
    postItem.appendChild(bodyEl);

    // Show delete button only if user is logged in
    if (sessionToken) {
      const deleteBtn = document.createElement('button');
      deleteBtn.innerText = 'Delete';
      deleteBtn.addEventListener('click', () => {
        deletePost(post.id);
      });
      postItem.appendChild(deleteBtn);
    }

    postList.appendChild(postItem);
  });
}

function createPost(title, body) {
  if (!sessionToken) {
    alert('You must be logged in to create posts.');
    return;
  }
  fetch(`${BASE_URL}/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionToken, title, body })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      document.getElementById('postTitle').value = '';
      document.getElementById('postBody').value = '';
      loadPosts();
    } else {
      alert(data.message || 'Failed to create post.');
    }
  })
  .catch(err => console.error(err));
}

function deletePost(id) {
  if (!sessionToken) {
    alert('You must be logged in to delete posts.');
    return;
  }
  fetch(`${BASE_URL}/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionToken, id })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      loadPosts();
    } else {
      alert(data.message || 'Failed to delete post.');
    }
  })
  .catch(err => console.error(err));
}
