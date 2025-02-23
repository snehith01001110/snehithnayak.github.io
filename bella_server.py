from flask import Flask, request, jsonify
from flask_cors import CORS
import bcrypt
import json
from datetime import datetime

app = Flask(__name__)
CORS(app)

def load_users():
    with open('users.json', 'r') as f:
        return json.load(f)

def load_posts():
    with open('data.json', 'r') as f:
        return json.load(f)

def save_posts(posts):
    with open('data.json', 'w') as f:
        json.dump(posts, f, indent=4)

@app.route('/login', methods=['POST'])
def login():
    data = request.json
    username = data['username']
    password = data['password'].encode('utf-8')
    users = load_users()
    
    if username in users and bcrypt.checkpw(password, users[username].encode('utf-8')):
        return jsonify({'success': True})
    return jsonify({'success': False})

@app.route('/posts', methods=['GET', 'POST'])
def posts():
    if request.method == 'GET':
        posts = load_posts()
        return jsonify({'posts': sorted(posts, key=lambda x: x['timestamp'], reverse=True)})
    
    if request.method == 'POST':
        data = request.json
        new_post = {
            'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'username': data['username'],
            'title': data['title'],
            'body': data['body']
        }
        posts = load_posts()
        posts.append(new_post)
        save_posts(posts)
        return jsonify({'success': True})

@app.route('/posts/<timestamp>', methods=['DELETE'])
def delete_post(timestamp):
    data = request.json
    username = data['username']
    posts = load_posts()
    post_to_delete = next((post for post in posts if post['timestamp'] == timestamp and post['username'] == username), None)
    
    if post_to_delete:
        posts.remove(post_to_delete)
        save_posts(posts)
        return jsonify({'success': True})
    return jsonify({'success': False})

if __name__ == '__main__':
    app.run(debug=True)