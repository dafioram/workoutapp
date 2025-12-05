# Use an official lightweight Python image for ARM (works on Raspberry Pi)
FROM python:3.11-slim

WORKDIR /app

# Copy and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app files
COPY . .

EXPOSE 5000
CMD ["python", "app.py"]