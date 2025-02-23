const BASE_URL = 'https://snehithn-server.onrender.com';

// Attempt to restore an existing session token
let sessionToken = localStorage.getItem('sessionToken') || null;

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  const postForm = document.getElementById('postForm');
  const logoutBtn = document.getElementById('logoutBtn');
  
  updateUI();
  loadPosts();

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

  if (sessionToken) {
    if (loginSection) loginSection.style.display = 'none';
    if (postSection) postSection.style.display = 'block';
    if (logoutSection) logoutSection.style.display = 'block';
  } else {
    if (loginSection) loginSection.style.display = 'block';
    if (postSection) postSection.style.display = 'none';
    if (logoutSection) logoutSection.style.display = 'none';
  }
}

function login(username, password) {
  fetch(`${BASE_URL}/login`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ username, password })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      sessionToken = data.sessionToken;
      localStorage.setItem('sessionToken', sessionToken);
      updateUI();
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
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ sessionToken })
  })
  .then(res => res.json())
  .then(data => {
    sessionToken = null;
    localStorage.removeItem('sessionToken');
    updateUI();
    loadPosts();
  })
  .catch(err => console.error(err));
}

function loadPosts() {
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

    // Show delete button only if user is logged in (and the server still checks ownership)
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
  fetch(`${BASE_URL}/create`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
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
  fetch(`${BASE_URL}/delete`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
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
