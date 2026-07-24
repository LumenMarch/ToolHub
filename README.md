# DjangoTools

A modular internal tools platform built with Django. The first tool compares two CSV files and reports added, deleted, and field-level modified records.

## Features

- Django session authentication
- Modern dark internal tools dashboard
- Extensible tool-card layout
- CSV upload and validation
- Configurable primary key
- Optional whitespace trimming and case-insensitive comparison
- Added, deleted, unchanged, and modified record summaries
- Field-level before/after diff viewer
- Django admin access for staff users

## Local setup

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

Open `http://127.0.0.1:8000/login/` and sign in with the account you created.

## Tests

```bash
python manage.py test
```

## Architecture

New tools should be added as isolated service modules under `tools/` first. As the platform grows, larger tools can be promoted into dedicated Django apps while sharing authentication, permissions, navigation, and audit infrastructure.
