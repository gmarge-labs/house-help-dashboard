# House Help Dashboard

A shared household task dashboard for a planner and a caretaker.

## What it does

- Gives the planner a private PIN-protected workspace to set up tasks, templates, dates, and instructions
- Gives the caretaker a separate PIN-protected checklist view with completion tracking
- Stores shared dashboard data in Firestore so the same board can be opened on multiple devices
- Generates a shareable dashboard link from `Settings`
- Shows a one-week caretaker day picker with `Off day` messaging when nothing is scheduled
- Supports task-level instructions instead of a single shared note area

## Files

- `index.html`: app shell and Firebase script loading
- `styles.css`: visual design and animated background
- `app.js`: state, rendering, planner/caretaker flows, and Firestore sync
- `firebase-config.js`: Firebase client configuration

## How to use it

1. Open the published app URL.
2. Create the dashboard with a planner PIN and a caretaker PIN.
3. Log in as `Planner` to create templates and assign tasks.
4. In `Settings`, use `Copy share link` and open that same link on the helper's device.
5. Log in as `Caretaker` on the helper device to view and complete tasks.

## Deployment

This folder is intended for a standalone GitHub Pages deployment.
