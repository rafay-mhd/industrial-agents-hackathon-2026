# Tricky-User Scripts: Interaction Benchmark & Test Conversations

This document specifies ten canonical test conversations testing conversational robustness, context retention, spatial reasoning, and graceful clarification.

Each scenario defines:
- **Scenario Name & Persona**: User background and intent.
- **Transcript**: User prompts and expected agent responses.
- **Expected Good Behavior**: Exact criteria scored under the 25 interaction points.
- **Common Failure Modes**: Anti-patterns the agent must avoid.

---

## 1. The Vague User ("the printer")

### Context
A visitor or employee asks for equipment without specifying a room or floor.

### Transcript
> **User**: Where is the printer?
>
> **Agent**:
> Understood: Locating printer
> I found three printers in the building:
> 1. Floor 1, Office corridor 1.01 (near the staircase)
> 2. Floor 1, Copy room 1.08
> 3. Floor 2, Main hall 2.05
>
> Which one would you like directions to?

### Expected Good Behavior
- Recognizes ambiguity immediately without hallucinating a specific printer.
- Asks **at most one** clarifying question.
- Lists candidate locations concisely with human landmarks (e.g., "near the staircase"), not raw IDs.

### Failure Modes to Avoid
- Picking one printer arbitrarily and giving a 100-meter route without asking.
- Dumping 20 JSON rows or internal database IDs.

---

## 2. The Wrong Room ("room 9.99")

### Context
User asks for a non-existent room number or typo.

### Transcript
> **User**: Take me to room 9.99.
>
> **Agent**:
> Understood: Route to room 9.99
> I couldn't find a room "9.99" in this building (floors are 0 through 2). Did you mean:
> - Office 1.09 (Floor 1)
> - Meeting room 2.09 (Floor 2)
> - Lab 0.19 (Ground floor)
>
> Let me know which room you are looking for.

### Expected Good Behavior
- Gracefully catches `MapError` / room lookup miss.
- Explains the building's floor range so the user understands why "9.99" doesn't exist.
- Suggests closest phonetic or numerical matches.

### Failure Modes to Avoid
- Crashing with an unhandled exception or stack trace.
- Inventing coordinates for room 9.99.

---

## 3. Changes Mind Halfway ("actually, take me to...")

### Context
User requests a route, then changes their destination mid-conversation.

### Transcript
> **User**: How do I get to Lab 0.12 from the main entrance?
>
> **Agent**:
> Understood: Route from Main Entrance to Lab 0.12
> From the main entrance, walk 15 m down the central corridor, and Lab 0.12 is on your right.
>
> **User**: Actually, let's go to the cafeteria first instead.
>
> **Agent**:
> Understood: Route from Main Entrance to Cafeteria 0.04
> Updated route: From the main entrance, turn immediately left instead of continuing down the corridor. The Cafeteria 0.04 entrance is 8 m ahead on your left.

### Expected Good Behavior
- Seamlessly updates destination from `Lab 0.12` to `Cafeteria 0.04`.
- Retains the user's initial start position (`Main Entrance`) without re-asking where they are starting from.
- Acknowledges the update cleanly ("Updated route: ...").

### Failure Modes to Avoid
- Asking "Where are you starting from?" again.
- Routing from Lab 0.12 to Cafeteria when the user never arrived at Lab 0.12.

---

## 4. The Wheelchair User Who Says It Once

### Context
User states a mobility constraint at the start; subsequent requests must remain step-free automatically.

### Transcript
> **User**: I'm using a wheelchair today. How do I get from the lobby to Office 2.14?
>
> **Agent**:
> Understood: Step-free route from Lobby 0.01 to Office 2.14
> From Lobby 0.01, proceed down the corridor 18 m to East Lift (step-free). Take the lift to Floor 2, exit straight ahead, and Office 2.14 will be the second door on your right (45.2 m total).
>
> **User**: Thanks! Where is the nearest restroom from here?
>
> **Agent**:
> Understood: Step-free route from Office 2.14 to nearest restroom
> The nearest accessible restroom is Restroom 2.08 on this floor, 12 m down the hall to your left (no steps).

### Expected Good Behavior
- Sets `step_free: true` for the session and keeps it active.
- Employs lifts instead of stairs for multi-floor routes.
- Prioritizes accessible amenities without requiring the user to repeat "I am in a wheelchair".

### Failure Modes to Avoid
- Sending the user to a staircase in turn 2.
- Forgetting mobility context across turns in the same session.

---

## 5. Lift Closed Mid-Day

### Context
A vertical connector is taken out of service; the agent recalculates routes and explains alternatives.

### Transcript
> **User**: The East Lift is closed for maintenance. How do I get to Floor 2?
>
> **Agent**:
> Understood: Mark East Lift as closed; route to Floor 2
> I have marked East Lift as closed.
>
> To reach Floor 2 from the ground floor, please use Central Staircase 0.17 (located 22 m west past the breakroom). If you require step-free access, West Cargo Lift 0.02 is operating and available via Hall Access 0.05.

### Expected Good Behavior
- Triggers `closed` action on the connector element ID.
- Explains the operational impact and offers both standard and step-free alternatives.
- Updates subsequent route queries to route around the closed element.

### Failure Modes to Avoid
- Saying "Okay, closed" without providing alternative directions.
- Continuing to route through the closed lift in subsequent turns.

---

## 6. First Day ("where do I get coffee?")

### Context
A new hire asks conversational, everyday questions that map to building amenities.

### Transcript
> **User**: It's my first day! Where do I get coffee?
>
> **Agent**:
> Understood: Locating coffee machine / kitchen
> Welcome! There is a coffee station in Kitchenette 0.19 on the ground floor, and a full espresso machine in the Floor 1 Breakroom (room 1.05).
>
> Kitchenette 0.19 is just around the corner: exit this room, turn right down the hall, and it's the second door with the glass panel.

### Expected Good Behavior
- Warm, professional tone.
- Maps colloquial request ("coffee") to appropriate semantic asset/room categories (`kitchen`, `breakroom`, `coffee_machine`).
- Gives concrete human navigation cues ("glass panel", "second door").

### Failure Modes to Avoid
- Responding "Error: space 'coffee' does not exist".
- Giving raw coordinate centroid values.

---

## 7. Hands-Full Technician Wanting Turn-by-Turn

### Context
A technician carrying equipment requests clear, concise landmark-based directions.

### Transcript
> **User**: My hands are full carrying a toolbox. Give me step-by-step directions to Server Room 1.03 from the loading bay.
>
> **Agent**:
> Understood: Turn-by-turn route from Loading Bay 0.01 to Server Room 1.03
> Here are your directions:
> 1. Exit Loading Bay 0.01 through the double doors into Corridor 0.02.
> 2. Walk straight 14 m past the recycling bins to Freight Lift 1.
> 3. Take Freight Lift 1 to Floor 1.
> 4. Step out of the lift, turn immediately left.
> 5. Server Room 1.03 is the reinforced door directly at the end of the short hallway (9 m).

### Expected Good Behavior
- Numbered, sequential steps formatted for quick scanning.
- Emphasizes physical landmarks (double doors, recycling bins, reinforced door).
- Mentions door widths/types suitable for someone carrying equipment.

### Failure Modes to Avoid
- Unformatted walls of text.
- Overly abstract mathematical descriptions.

---

## 8. Facility Manager Adding a Door

### Context
A facility manager updates the building layout by punching a new doorway through a shared wall.

### Transcript
> **User**: We punched a new door between Office 2.03 and Meeting Room 2.04. Add it to the map.
>
> **Agent**:
> Understood: Add new door between Office 2.03 and Meeting Room 2.04
> I have added a new 0.9 m step-free door connecting Office 2.03 and Meeting Room 2.04 along their shared wall.
>
> Routes between Office 2.03 and Meeting Room 2.04 no longer need to loop around Corridor 2.01, reducing travel distance from 38.5 m to 3.2 m.

### Expected Good Behavior
- Calls `add_door(2.03, 2.04)`.
- Triggers `door_added` action in the UI.
- Calculates and states the tangible benefit (distance saved).

### Failure Modes to Avoid
- Failing to verify that the rooms share a wall.
- Omitting confirmation of the route impact.

---

## 9. Multi-Stop Tour ("fetch X, take to Y, then meet at Z")

### Context
Complex errand chaining involving multiple stops and constraints.

### Transcript
> **User**: I need to pick up a calibration tool from Tool Storage 0.08, drop it at CNC Mill 2, and then head to Seminar Room 1.15. What's the best route?
>
> **Agent**:
> Understood: Multi-stop route: Current position → Tool Storage 0.08 → CNC Mill 2 (Production zone H-A2) → Seminar Room 1.15
> Total distance: 168.4 m.
>
> Leg 1 (42 m): Walk north through Corridor 0.01 to Tool Storage 0.08.
> Leg 2 (58 m): Exit with the tool, proceed through the double doors into Production zone H-A2 to CNC Mill 2.
> Leg 3 (68.4 m): Take Central Staircase 0.17 up to Floor 1, then proceed 25 m down the east wing to Seminar Room 1.15.

### Expected Good Behavior
- Resolves each waypoint correctly.
- Breaks down the journey into distinct legs with per-leg distances and cumulative distance.
- Handles transitions between floors seamlessly.

### Failure Modes to Avoid
- Flattening all stops into a single confusing direction.
- Skipping intermediate legs.

---

## 10. Question About Another Floor Without Stating the Floor

### Context
User asks for a room by name or number without specifying the floor level.

### Transcript
> **User**: How big is the conference room in the west wing?
>
> **Agent**:
> Understood: Area lookup for West Conference Room
> West Conference Room 1.20 on Floor 1 is **78.4 m²** (capacity approx. 30 people).
>
> (If you meant West Meeting Room 0.14 on the ground floor, that room is 24.1 m²).

### Expected Good Behavior
- Searches across all floors automatically when floor is omitted.
- Identifies the primary match and proactively mentions secondary matches on other floors.
- Reports exact polygon area with $\pm 5\%$ tolerance compliance.

### Failure Modes to Avoid
- Asking "Which floor?" when there is a unique or clear match.
- Guessing without acknowledging other candidate rooms.
