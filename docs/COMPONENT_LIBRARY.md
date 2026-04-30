# Component Library (v1)

Live reference page: `/style-guide` implemented in [StyleGuide.tsx](file:///c:/Users/mohamed.abass.WUSOOM/Downloads/RAK/D/Map/Logo/ESRI/Map/Agri/src/pages/StyleGuide.tsx).

## Components

### Button
File: [Button.tsx](file:///c:/Users/mohamed.abass.WUSOOM/Downloads/RAK/D/Map/Logo/ESRI/Map/Agri/src/components/ui/Button.tsx)

Variants:
- `primary`
- `secondary` (default)
- `danger`
- `ghost`

Example:
```tsx
import { Button } from '../components/ui/Button'

<Button>Secondary</Button>
<Button variant="primary">Save</Button>
<Button variant="danger">Delete</Button>
<Button variant="ghost">More</Button>
```

### Input
File: [Input.tsx](file:///c:/Users/mohamed.abass.WUSOOM/Downloads/RAK/D/Map/Logo/ESRI/Map/Agri/src/components/ui/Input.tsx)

Example:
```tsx
import { Input } from '../components/ui/Input'

<div className="ds-label">Name</div>
<Input placeholder="Enter name" />
```

### Select
File: [Select.tsx](file:///c:/Users/mohamed.abass.WUSOOM/Downloads/RAK/D/Map/Logo/ESRI/Map/Agri/src/components/ui/Select.tsx)

Example:
```tsx
import { Select } from '../components/ui/Select'

<div className="ds-label">Type</div>
<Select defaultValue="">
  <option value="" disabled>Select…</option>
  <option value="one">One</option>
</Select>
```

### Textarea
File: [Textarea.tsx](file:///c:/Users/mohamed.abass.WUSOOM/Downloads/RAK/D/Map/Logo/ESRI/Map/Agri/src/components/ui/Textarea.tsx)

### Card
File: [Card.tsx](file:///c:/Users/mohamed.abass.WUSOOM/Downloads/RAK/D/Map/Logo/ESRI/Map/Agri/src/components/ui/Card.tsx)

### Modal
File: [Modal.tsx](file:///c:/Users/mohamed.abass.WUSOOM/Downloads/RAK/D/Map/Logo/ESRI/Map/Agri/src/components/ui/Modal.tsx)

Notes:
- Click-outside closes the modal.
- Uses `role="dialog"` and `aria-modal="true"`.
- Global focus ring styling is handled in [index.css](file:///c:/Users/mohamed.abass.WUSOOM/Downloads/RAK/D/Map/Logo/ESRI/Map/Agri/src/index.css).

