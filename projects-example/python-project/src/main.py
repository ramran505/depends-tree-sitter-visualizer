from utils import greet_user
from config import APP_NAME
from math_tools import add
from logger import log

def main():
    log(f"Starting {APP_NAME}")
    greet_user("Ray")
    result = add(10, 5)
    log(f"Result is {result}")

if __name__ == "__main__":
    main()
