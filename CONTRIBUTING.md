# Contributing to QuickDesk

Thank you for your interest in contributing to **QuickDesk**! We welcome contributions from developers of all skill levels. Whether you are fixing a bug, adding a new feature, improving documentation, or optimizing performance, your help is appreciated.

---

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Please treat all contributors with respect and courtesy.

---

## Getting Started

### 1. Fork and Clone the Repository
```bash
git clone https://github.com/your-username/quickdesk.git
cd quickdesk
```

### 2. Set Up the Backend
We recommend using a Python virtual environment:
```bash
# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Windows:
venv\Scripts\activate
# On Linux/macOS:
source venv/bin/activate

# Install dependencies
pip install -r backend/requirements.txt
```

### 3. Set Up the Frontend (Optional for Development)
If you want to modify or develop the React frontend:
```bash
cd frontend
npm install
npm start
```
The React development server runs at `http://localhost:3000`. Set `REACT_APP_BACKEND_URL=http://localhost:9000` in `frontend/.env` if testing against the backend on port 9000.

To build the production bundle served directly by FastAPI:
```bash
cd frontend
npm run build
```

---

## Development Workflow

1. **Create a Feature Branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. **Make your changes**:
   - Keep code clean, modular, and well-commented.
   - Follow PEP 8 style for Python code.
   - Follow standard React Hooks patterns and avoid unnecessary dependencies.
3. **Test your changes**:
   - Run the backend test suite:
     ```bash
     python backend/test_api.py
     ```
   - Test WebRTC streaming and remote controls across multiple browser windows or devices.
4. **Commit with descriptive messages**:
   ```bash
   git commit -m "feat(webrtc): add adaptive bitrate control for low-bandwidth networks"
   ```
5. **Push and create a Pull Request**:
   ```bash
   git push origin feature/your-feature-name
   ```
   Open a Pull Request on GitHub describing your changes, test results, and any relevant context.

---

## Reporting Issues & Feature Requests

- **Bug Reports**: Please include your OS, browser version, Python version, steps to reproduce, and any terminal or browser console logs.
- **Feature Requests**: Describe the problem you are trying to solve, why the feature is useful, and any potential implementation ideas.

---

## License

By contributing to QuickDesk, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
