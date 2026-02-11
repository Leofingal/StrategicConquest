# Memory and Instructions Recommendations

## Proposed Memory Section Updates

Add these items to the project's Memory to capture critical context that should persist across all threads:

---

### Architecture & Design Approach

**Add to Memory:**
```
The Strategic Conquest project uses a modular architecture to prevent context window overload. The game is divided into 8-9 independent modules with clear interfaces:

1. game-state.js - Pure state management (no UI)
2. map-generator.js - Procedural generation (already complete)
3. combat-engine.js - Combat calculations (already complete)
4. movement-engine.js - Movement validation and pathfinding
5. ai-opponent.js - AI decision-making (configurable behavior)
6. fog-of-war.js - Visibility calculations
7. ui-components.jsx - Reusable UI elements
8. dialog-components.jsx - Modal dialogs
9. strategic-conquest-game.jsx - Main orchestrator (400 lines max)

Each module has defined interfaces in MODULE_INTERFACES.md. Development should focus on one module at a time to stay within context limits.
```

---

### File Organization & Workflow

**Add to Memory:**
```
Design documents are maintained in this thread:
- MODULAR_ARCHITECTURE.md - System architecture and module breakdown
- AI_OPPONENT_SPEC.md - AI behavior and decision-making design
- MODULE_INTERFACES.md - Function signatures and data structures
- strategic-conquest-summary.md - Game rules and specifications

Implementation threads should:
1. Read relevant design docs first (use view tool)
2. Implement one module at a time
3. Return to this thread with questions or design changes
4. Keep JSX files focused (200-400 lines per module)
```

---

### Code Development Pattern

**Add to Memory:**
```
When developing code:
- Start by viewing the relevant MODULE_INTERFACES.md section
- Implement only the public API functions defined there
- Keep modules independent (minimal cross-dependencies)
- Test modules in isolation before integration
- Document any deviations from interfaces in this design thread

When threads run into context limits:
- Switch to a new thread for the next module
- Use this design thread to coordinate and update specs
- Maintain LATEST and LATEST-1 versions in /outputs
```

---

### AI Development Priority

**Add to Memory:**
```
Current critical issue: AI opponent not taking turns in strategic-conquest-game.jsx

AI implementation should follow this priority:
1. Extract AI logic into separate ai-opponent.js module
2. Add extensive logging to diagnose execution flow
3. Start with simplest behavior (capture nearest neutral city)
4. Verify AI executes moves each turn
5. Gradually add complexity (exploration, production, strategy)
6. Tune with exposed AI_CONFIG parameters

AI should be completely independent module that receives GameState and returns modified GameState. No direct UI dependencies.
```

---

### Testing & Iteration

**Add to Memory:**
```
Development cycle per module:
1. Create module based on interface spec
2. Test in isolation (unit tests or simple test harness)
3. Document any issues or interface changes needed
4. Integrate with main game
5. Playtest and iterate

User (Chris) provides playtest feedback in design thread. Code refinement happens in implementation threads. This separation prevents design discussions from consuming implementation context window.
```

---

## Proposed Instructions Section

Add these custom instructions to guide Claude's behavior across all threads:

---

### Project Structure Awareness

**Add to Instructions:**
```
This is a modular software development project. Before writing any code:

1. Check if design documents exist for the component (view /mnt/project/*.md)
2. Read the relevant section of MODULE_INTERFACES.md
3. Follow the defined interfaces exactly
4. Flag any interface changes needed (don't just modify)

If design docs are unclear or missing, ask clarifying questions before coding.
```

---

### Context Window Management

**Add to Instructions:**
```
To prevent context overflow:

- Each module should be 200-400 lines maximum
- If a file exceeds 500 lines, propose splitting it
- Use design docs as reference (view them) rather than rebuilding knowledge
- Focus on one module per thread
- Suggest moving to new thread if context feels tight

When approaching context limits, explicitly state: "This thread is nearing context limits. Recommend [specific action]."
```

---

### Modular Development Discipline

**Add to Instructions:**
```
When implementing a module:

1. Export ONLY functions defined in MODULE_INTERFACES.md
2. Use clear, consistent naming from specs
3. Document any helper functions as "internal"
4. Avoid tight coupling between modules
5. Test module independently before integration

If you need to modify an interface, STOP and discuss in the design thread first. Interface changes affect all dependent modules.
```

---

### AI Development Guidelines

**Add to Instructions:**
```
When working on AI opponent:

1. AI must be entirely in ai-opponent.js module
2. AI receives GameState, returns modified GameState
3. AI behavior controlled by AI_CONFIG object (see AI_OPPONENT_SPEC.md)
4. Add console.log statements liberally for debugging
5. Start simple, add complexity incrementally

AI personality and difficulty should be tunable without code changes. Expose parameters in AI_CONFIG.
```

---

### Communication with Design Thread

**Add to Instructions:**
```
This design thread (current) coordinates development:

- Report issues/questions here
- Propose architecture changes here
- Update design docs here
- Keep implementation details in separate threads

When you identify a design problem, state clearly:
"This needs design discussion. Issue: [problem]. Suggest: [solution]. Waiting for approval before implementing."
```

---

### Testing & Validation

**Add to Instructions:**
```
For each module created:

1. Provide simple test cases showing usage
2. Demonstrate module works independently
3. Show integration points clearly
4. Include error handling

Example test format:
```javascript
// Test: Tank moves to adjacent land tile
const state = createTestGameState();
const result = moveUnit(state, tankId, 1, 0);
assert(result.success === true);
assert(result.state.units.find(u => u.id === tankId).x === 11);
```
```

---

### File Management

**Add to Instructions:**
```
File organization:

- Design docs: /mnt/project/ (read-only reference)
- Work files: /home/claude/ (temporary)
- Deliverables: /mnt/user-data/outputs/ (for user)

When providing final module:
1. Save to /outputs with clear filename (e.g., ai-opponent-v2.js)
2. Include version number if iterating
3. Provide brief usage example
4. Note any dependencies

User maintains LATEST and LATEST-1 versions for rollback.
```

---

### Tone & Communication

**Add to Instructions:**
```
When responding:

- Be direct and technical with implementation details
- Ask specific questions when specs are ambiguous
- Propose solutions, don't just identify problems
- Summarize what was accomplished at end of response
- Flag when approaching context limits

Keep responses focused on the work. Chris prefers detailed technical discussion over pleasantries.
```

---

### Design Change Process

**Add to Instructions:**
```
If you discover a design issue during implementation:

1. STOP implementation
2. Document the issue clearly
3. Propose 2-3 solutions with tradeoffs
4. Wait for design approval
5. Update design docs before continuing

Example: "Issue found: AI pathfinding exceeds performance budget. Options: (1) Limit path length to 50 tiles, (2) Use breadth-first instead of A*, (3) Cache paths for repeated queries. Recommend option 1 for simplicity. Approve?"
```

---

## Memory vs Instructions Distinction

**Memory (what to remember):**
- Architecture decisions made
- Module boundaries and interfaces
- Current state of project
- Known issues and priorities
- Design patterns established

**Instructions (how to behave):**
- Process to follow when coding
- When to ask questions
- How to manage context window
- Communication style preferences
- File organization rules

---

## Immediate Actions for This Thread

1. **Review and refine** these memory/instructions suggestions
2. **Add to Memory section** approved items (user does this)
3. **Update Instructions** with approved guidelines (user does this)
4. **Create next steps plan** for implementation threads

---

## Example Memory Entry (Complete)

Here's a complete example of what could be added to Memory:

```
**Strategic Conquest Development Approach**

Modular architecture with 9 components (see MODULAR_ARCHITECTURE.md). Each module 200-400 lines with defined interfaces (MODULE_INTERFACES.md). This design thread coordinates development; implementation happens in separate threads to manage context window.

Critical modules:
- game-state.js: Pure state management
- ai-opponent.js: AI behavior (currently broken, high priority)
- movement-engine.js: Pathfinding and validation
- ui-components.jsx: Reusable UI elements

AI must be separate module with configurable behavior via AI_CONFIG. No direct UI coupling.

Design docs maintained in /mnt/project/. User (Chris) provides playtest feedback here. Keep implementation threads focused on single modules.

File management: LATEST and LATEST-1 versions in /outputs for rollback. Clear version numbering.
```

---

## Example Instructions Entry (Complete)

Here's a complete example of custom instructions:

```
This is a modular game development project. Before coding:
1. View relevant design docs in /mnt/project/
2. Read MODULE_INTERFACES.md for function signatures
3. Implement only defined public APIs
4. Flag any interface changes for discussion

Keep modules 200-400 lines. If file exceeds 500 lines, propose splitting.

For AI development:
- Must be in separate ai-opponent.js
- Receives GameState, returns GameState
- Behavior controlled by AI_CONFIG
- Add debug logging liberally

Report issues to design thread. Implement in separate threads. When approaching context limits, suggest moving to new thread.

Be direct and technical. Propose solutions, not just problems. Chris prefers detailed technical discussion.
```

---

## Testing These Additions

After updating Memory/Instructions, test by:

1. Starting a new implementation thread
2. Asking Claude to implement a module
3. Verify Claude references design docs
4. Check if Claude follows interfaces
5. Observe if Claude manages context appropriately

Iterate based on results.
