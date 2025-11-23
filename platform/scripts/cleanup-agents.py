#!/usr/bin/env python3
"""
Cleanup script to delete all non-default agents.

Usage:
  python3 scripts/cleanup-agents.py

Requires ARCHESTRA_API_KEY environment variable.
"""

import os
import sys
import json
import subprocess

API_KEY = os.environ.get('ARCHESTRA_API_KEY')
API_BASE_URL = os.environ.get('API_BASE_URL', 'http://localhost:9000')

if not API_KEY:
    print('❌ Missing ARCHESTRA_API_KEY environment variable')
    print('   Create an API key in the Archestra UI under Settings → Your Account')
    sys.exit(1)

# Get all agents
result = subprocess.run(
    ['curl', '-s', f'{API_BASE_URL}/api/agents', '-H', f'Authorization: {API_KEY}'],
    capture_output=True, text=True
)

try:
    response = json.loads(result.stdout)
except json.JSONDecodeError:
    print(f'❌ Failed to parse API response: {result.stdout}')
    sys.exit(1)

if isinstance(response, dict) and 'error' in response:
    print(f'❌ API error: {response["error"]["message"]}')
    sys.exit(1)

# API returns paginated response with 'data' field
if isinstance(response, dict) and 'data' in response:
    agents = response['data']
else:
    agents = response

to_delete = [a for a in agents if not a.get('is_default')]
default_agents = [a for a in agents if a.get('is_default')]

print(f'📊 Found {len(agents)} total agents')
print(f'   Keeping {len(default_agents)} default agent(s): {[a["name"] for a in default_agents]}')
print(f'   Will delete {len(to_delete)} non-default agents\n')

if len(to_delete) == 0:
    print('✅ Nothing to delete!')
    sys.exit(0)

# Ask for confirmation
response = input(f'⚠️  Delete {len(to_delete)} agents? [y/N] ')
if response.lower() != 'y':
    print('Cancelled.')
    sys.exit(0)

# Delete agents
for i, a in enumerate(to_delete, 1):
    print(f'🗑️  {i}/{len(to_delete)}: Deleting {a["name"]} ({a["id"][:8]}...)...')
    subprocess.run([
        'curl', '-s', '-X', 'DELETE',
        f'{API_BASE_URL}/api/agents/{a["id"]}',
        '-H', f'Authorization: {API_KEY}'
    ], capture_output=True)

print(f'\n✅ Done! Deleted {len(to_delete)} agents')
